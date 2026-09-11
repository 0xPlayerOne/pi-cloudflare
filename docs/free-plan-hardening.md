# Free-plan hardening across the estate

Applied 2026-09-11 across 4 accounts and 16 zones (all on the Free plan) as the
configuration phase of the free-feature audit. Every change below was verified
live after applying; the traps are recorded because each cost real debugging
time and several return HTTP 200 while doing nothing.

## What the Free plan actually gates

Settled by replaying each call with a full dashboard session, so the failure is
entitlement and not token scope:

| Surface                        | Verdict                                                                                                                                                           |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Argo Smart Routing             | `401 1015` — paid zone setting. Its Security Center suggestion (`argo_smart_routing_not_enabled`) is **not actionable** on Free; dismiss it rather than chase it. |
| Polish / Mirage / WebP         | `editable: false` — paid zone settings. `polish_not_enabled` is likewise not actionable.                                                                          |
| Image Transformations / Images | `allowed: 0` on `/images/v1/stats` — requires a paid Images plan.                                                                                                 |
| Snippets                       | `403 snippets are not allowed` on PUT — Free-plan-disabled, so they cannot serve `security.txt`.                                                                  |
| Tiered Caching                 | Free where offered, but `editable: false` on the zones that have it off.                                                                                          |
| Minify                         | `PATCH` returns 200 and the value never changes — dashboard-only now.                                                                                             |
| `waf` zone setting             | `400 WAF is deprecated for this zone, Managed Rulesets should be used instead.`                                                                                   |

## Traps: endpoints that answer 200 without applying anything

These are the dangerous ones — a success status with no effect. Always re-read
the resource after writing.

- **DNSSEC.** `PUT` with an explicit body enables it. `PATCH` returns 200 and is
  a no-op while the zone is `disabled`; `PUT` with an empty body returns the
  unchanged `disabled` state. Both look like success. Use
  `PUT {status:"active"}`, then re-read to confirm the zone moved to `pending`.
- **Bot management.** `PATCH` returns `405 10405 Method not allowed for this
authentication scheme`; `PUT` works. The AI-bot fields live here
  (`ai_bots_protection`), not under `settings`.
- **`PATCH /settings/{id}`** silently ignores unknown or removed settings
  (minify). Compare the returned `result.value` against what you sent.

## What was applied

| Change                                           | Zones | Notes                                   |
| ------------------------------------------------ | ----- | --------------------------------------- |
| Minimum TLS 1.2                                  | 4     | was allowing TLS 1.0                    |
| Always Use HTTPS                                 | 1     |                                         |
| 0-RTT + TLS 1.3 `zrt`                            | 2     | repeat-visit round-trip reduction       |
| Early Hints (HTTP 103)                           | 2     |                                         |
| HSTS (6mo, includeSubDomains, nosniff)           | 2     | now all 16                              |
| AI bot protection → `block`                      | 3     | resolves `no_challenge_ai_bots`         |
| DNSSEC enabled                                   | 12    | 4 active, 12 pending registrar DS       |
| Cloudflare **free managed WAF ruleset** deployed | 16    | was unapplied everywhere except by hand |
| Baseline security headers                        | 1     | adea.dev only — see below               |
| Turnstile widget                                 | 1     | created; secret requires secure storage |

The free managed WAF ruleset object already exists on every zone but ships
**unapplied** — there is no entrypoint until an `execute` rule references it, so
zones have zero managed coverage by default. Deploying it is one `PUT` to
`rulesets/phases/http_request_firewall_managed/entrypoint`:

```jsonc
{
  "rules": [
    {
      "action": "execute",
      "description": "Deploy Cloudflare Free Managed Ruleset",
      "enabled": true,
      "expression": "true",
      "action_parameters": { "id": "<managed ruleset id>" },
    },
  ],
}
```

Coverage is 31 rules against specific CVEs (Log4j, Shellshock, WordPress
plugin/injection families), not a general WAF.

Verified blocking, with normal traffic and assets staying `200`:

| Probe                                      | Result                        |
| ------------------------------------------ | ----------------------------- |
| `${jndi:ldap://…}` in a request **header** | `403` — blocked               |
| Shellshock payload in `User-Agent`         | `403` — blocked               |
| `${jndi:ldap://…}` in the **URI path**     | `307`/`308` — **not blocked** |

The URI case is the one to be careful about: those codes are Cloudflare's
path-normalization redirects, not a block. Log4j's URI vector is therefore not
covered by the free set, so do not treat a non-403 on a URI payload as a broken
deploy — and do not claim URI coverage. SQLi/XSS payloads are likewise **not** in
the free set.

## The finding that matters most: unproxied apexes bypass everything

`niftyleague.com` and `niftysmashers.com` resolve to **Vercel directly**
(`server: Vercel`, no `cf-ray`). Traffic to those apexes never touches
Cloudflare, so **no zone setting, WAF rule, cache rule, or transform applies to
them** — including the rules deployed in this pass. Only `www.` is proxied, and
it merely 301s to the unproxied apex.

Proxying these would extend the whole hardening set to the main marketing sites,
but it is deliberately **not** done here:

- `shop.niftyleague.com` is a Shopify CNAME. Shopify does not support the
  orange-cloud proxy in front of `shops.myshopify.com`; proxying risks breaking
  the storefront and checkout.
- The Vercel CNAMEs are the same class of change: proxying interacts with
  Vercel's own edge, TLS provisioning, and HTTP-01 domain validation.

These are production architecture decisions for the site owners, not
audit-time config flips. Treat the nine `cname_record_not_proxied` insights as
**intentional until decided**, and do not mass-proxy them to clear the list.

## Registrar: where the DS record actually comes from

The estate splits across registrars, which decides who can finish DNSSEC:

| Registrar                | Zones                                                                                                                                      |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Cloudflare               | adea.dev, dubdev.com, niftyleague.app, niftyleague.co, niftyleague.dev, niftyleague.net, niftyleague.org, pinkbinder.blog, pinkbinder.shop |
| Squarespace Domains      | andrewmf.com, nifty-league.com, niftyleague.com, niftysmashers.com                                                                         |
| Namecheap                | pinkbinder.store                                                                                                                           |
| other / RDAP unavailable | nftl.nl, niftyworld.gg                                                                                                                     |

**The registrar DS step cannot be automated with an API token.** This was
checked exhaustively rather than assumed:

- The Registrar API exposes `registrar/domains`, `registrar/registrations`, and
  their sub-resources. Grepping the full published OpenAPI spec for
  `dnssec` / `ds_record` inside every registrar section returns **zero** matches.
- `PUT /accounts/:id/registrar/domains/:domain` is documented and accepts only
  `auto_renew`, `locked`, and `privacy`. Sending `ds_records` returns `200` and
  changes nothing — the same silent-no-op class of trap as `PATCH /settings/:id`.
  Verified harmless: the domain record was byte-identical afterwards.
- Domain objects carry a read-only `ds_records` array. A domain whose DS is
  published (adea.dev) shows the record there; one awaiting publication
  (niftyleague.app) shows `[]`.

So for Cloudflare-registered domains the DS is published from the **dashboard**
during the DNSSEC enable flow. For the other registrars it must be added as a DS
record at that registrar. Zone-side state is correct everywhere: DNSSEC is
`pending` with the key material present and CDS/CDNSKEY published, so only the
parent-side DS is outstanding. Resolution is unaffected until it lands
(`NOERROR` throughout, and an absent DS cannot break validation).

## Turnstile secrets live in Secrets Store

The three widgets' sitekey/secret pairs were captured at creation and written to
**Cloudflare Secrets Store** in each account. Turnstile returns the secret only
in the create response, so a missed capture means rotating the widget.

Notes for anyone repeating this:

- Free plan allows **one store per account**. Adea and Pink Binder already had
  one (`control-plane-neon`, `default_secrets_store`), so those are reused
  rather than replaced; Nifty League and Personal got a `pi-cloudflare` store.
- The create endpoint takes a **bulk array**, not a single object
  (`POST /accounts/:id/secrets_store/stores/:store_id/secrets` with
  `[{name, value, scopes}]`). A bare object fails with
  `1001 invalid_json_body`.
- `scopes: ["workers"]` binds each secret for Workers consumption.
- Stored values are write-only on read-back, which is why they must be captured
  at creation.

## Vercel migration is unblocked

Both apexes were confirmed to resolve straight to Vercel, and the estate is ready
for the rest to follow:

- **No CAA records on any of the 16 zones**, so no CA is restricted — Vercel can
  issue certificates for any domain moved over. A restrictive CAA would have been
  the classic silent blocker here.
- All 16 zones already run `ssl: full` with `always_use_https: on` and
  `min_tls_version: 1.2`, which is the correct baseline in front of Vercel.
- Cloudflare must stay in front of the Vercel origins for the zone features in
  this document to apply at all, which is the reason the apex records are left
  proxied rather than delegated to Vercel's nameservers.
- Every zone keeps its DNSSEC key material and CDS/CDNSKEY published, so the DS
  can be completed at any registrar without touching zone config.

## security.txt has no API

Security Center suggests `security_txt_not_enabled`, but there is no public
endpoint for it (only `insights`, `class`, `severity`, `type`, `audit-log`,
`context`, and dismiss/classification). Serving it needs either a Workers
route or the enclosing app's static assets — a code change in each app's repo,
not a Cloudflare API call. Snippets would have been the natural fit and are
Free-plan-disabled.

## Re-audit

```bash
CLOUDFLARE_API_TOKEN=... node scripts/verify-api-token.mjs
```

Then diff the live state against `wrangler`-free probes: `/zones/:id/settings`,
`/zones/:id/dnssec`, and the `http_request_firewall_managed` entrypoint. Remember
the settings and ruleset reads are cached briefly — re-check with a cache-busting
query string before concluding a change did not apply.
