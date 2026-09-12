---
name: cloudflare-hardening
description: Audits and hardens every Cloudflare account and zone in a user's estate by adopting free-tier security, performance, and reliability features. Use when a user asks to audit, harden, secure, optimize, or "get the most out of" Cloudflare, mentions Security Center insights, free-tier features, DNSSEC, WAF, security headers, cache or compression rules, TLS settings, bot protection, or Turnstile, or wants an estate-wide review rather than a single-zone change.
---

# Cloudflare hardening

Takes a user's whole Cloudflare estate — every account, every zone — and moves it
to a hardened, optimized baseline using features available on its plans.

Two properties matter more than speed:

- **Measure first.** The estate is the source of truth, not this document. Many
  "gaps" are already handled by the origin, and several changes that look like
  wins actively break things. Read the live state before writing anything.
- **Prefer reversible, low-blast-radius changes.** Settings and rules are easy to
  revert; DNS proxying and SSL mode are not. Where a change is an architecture
  decision, surface it for the user instead of making it.

## Before you start

**Token scope.** The audit needs read access across accounts and zones, plus write
access for whatever it changes. If calls fail with `403 Authentication error`,
the token is missing a permission group — see the `cloudflare-api-token` and
`cloudflare-token-scopes` skills for how to enumerate and extend groups. A JSON
`403` is a scope gap; an HTML `403` from a dashboard session is a WAF challenge,
not a permission problem.

**Confirm the blast radius.** The user may want one zone, one account, or
everything. Ask if it is not clear, and say what you are about to change before
changing it. Reversible settings changes are usually fine to batch; anything in
[Safety rules](#safety-rules-do-not-blanket-change) needs explicit sign-off.

## Ground rules

1. **Discover, never assume.** Enumerate accounts from `GET /accounts` and zones
   from `GET /zones`. Never hard-code an account ID, zone ID, or domain — the
   same skill has to run against estates the user has not described yet.

2. **Read the live response, not just the config.** A setting being `on` does not
   mean the header is present: an unproxied record never executes zone rules, and
   an origin can override what you set. Probe the real URL before and after.

3. **Never trust an HTTP 200.** Several Cloudflare endpoints return `200` and
   change nothing. See [Silent no-ops](#silent-no-ops-http-200-with-no-effect).
   After every write, re-read the resource and compare.

4. **Distinguish entitlement from permission.** When a call fails, replay it with
   the user's dashboard session (or check the dashboard UI). If that also fails,
   it is a plan gate, not a token-scope problem — do not add permission groups
   chasing it.

5. **Allow time to propagate.** Rule and setting changes can read back stale for
   a couple of minutes. Re-probe with a cache-busting query before concluding a
   write failed.

## Workflow

### 1. Inventory (read-only)

Run the bundled audit script. It walks every account and zone and prints a gap
report without changing anything:

```bash
CLOUDFLARE_API_TOKEN=... node scripts/audit.mjs          # human summary
CLOUDFLARE_API_TOKEN=... node scripts/audit.mjs --json   # machine-readable
```

The script reports gaps; it deliberately does not fix them, because several
fixes need judgement from the live probe. Work from its output, and see
`references/api-reference.md` for the underlying calls if you need to go beyond
it.

### 2. Per zone: settings and rules

For each zone, read `GET /zones/:id/settings` and reconcile against this
baseline. Only change what differs, and note that the estate's current values may
be deliberate.

| Setting | Baseline | Notes |
| --- | --- | --- |
| `min_tls_version` | `1.2` | `1.3` only if no legacy clients. `1.0`/`1.1` are deprecated and dropped by browsers |
| `always_use_https` | `on` | Redirects http to https |
| `automatic_https_rewrites` | `on` | |
| `tls_1_3` | `zrt` | `zrt` adds zero-round-trip resumption |
| `0rtt` | `on` | Skips a round trip on repeat visits. 0-RTT is replayable, so avoid it if the zone fronts non-idempotent writes on the same connection |
| `early_hints` | `on` | HTTP 103 preloads critical assets |
| `http2`, `http3`, `brotli`, `websockets`, `ipv6`, `opportunistic_encryption` | `on` | Usually already on |
| `security_level` | `medium` | Raise only during an active attack |
| `development_mode` | `off` | Never leave on; it disables caching and most optimizations |

Then check the ruleset phases and add what is missing:

- **`http_request_firewall_managed`** — deploy the **free managed ruleset**. This
  is usually the single highest-value change, because the ruleset object already
  exists on every zone but ships *unapplied*: there is no entrypoint until an
  `execute` rule references it. A zone with no entrypoint has zero managed WAF
  coverage. Payload in `references/api-reference.md`.
- **`http_response_headers_transform`** — add the baseline security headers the
  live response is actually missing.
- **`http_response_compression`** — extend compression to binary model and font
  types the built-in set omits.
- **`http_request_cache_settings`** — only with a measured reason; see
  [Safety rules](#safety-rules-do-not-blanket-change).

And remove what hurts performance. Hardening is not only additive:

- **`enable_js` (JavaScript Detections)** — injects
  `/cdn-cgi/challenge-platform/scripts/jsd/main.js` into every HTML response and
  trips Lighthouse Best Practices "Avoid deprecated APIs", costing roughly 40
  Best-Practices points on a fast site. Turn it off; it protects nothing that
  `ai_bots_protection: "block"` does not cover without injecting anything.
- **`fight_mode` (Bot Fight Mode)** — a genuine tradeoff rather than a free win.
  It adds edge protection but rides on the same injected detection script. Report
  the cost and let the user choose.

### 3. Per zone: DNSSEC

Read `GET /zones/:id/dnssec`. If `disabled`, it is safe to stage: enabling is
**inert** until the registrar publishes the matching DS record, and an absent DS
cannot break validation. Confirm the parent has no DS first (`dig +short DS
<zone>`), then enable and hand the user the DS record.

Publishing the DS **cannot be automated**. Verify this rather than promising it:
Cloudflare's OpenAPI spec contains no registrar-side DS write, and
`PUT /accounts/:id/registrar/domains/:domain` accepts only `auto_renew`,
`locked`, and `privacy` — it returns `200` and ignores `ds_records`. Report which
domains are at which registrar, with the DS record for each, and let the user
finish it in the dashboard or at the registrar.

### 4. Per account

- **Security Center** (`GET /accounts/:id/security-center/insights`) — the
  starting point for what the platform itself flags. Insights re-evaluate on
  Cloudflare's schedule (roughly daily), so they will not clear immediately after
  a fix. Some are non-actionable; see `references/paid-features.md`.
- **Zero Trust** — check existing Access apps have a policy, and that session
  duration is sensible. Do not create apps unprompted; report.
- **Turnstile** — creating a widget is free. The **secret is returned only in the
  create response** and never again, so capture it immediately and persist it
  somewhere durable (see the Secrets Store notes in `references/api-reference.md`).
- **Secrets Store / Registrar / storage inventory** — useful context; report
  rather than change.

### 5. Verify and report

Re-probe everything you changed, from the public internet:

```bash
curl -sI https://<zone>/ | grep -iE "^(strict-transport-security|x-content-type-options|referrer-policy)"
```

Then confirm the zone still resolves and serves (`dig +short A`, HTTP status), and
close with the report format below.

## Silent no-ops: HTTP 200 with no effect

The most dangerous failure mode here, because the write looks successful. Every
item below was confirmed against the live API. Always re-read the resource after
writing and compare values.

| Operation | Behaviour |
| --- | --- |
| DNSSEC enable | `PATCH` with an empty body and `PUT` with an empty body both return `200` and leave the zone `disabled`. Use `PATCH {status:"active"}` (documented) or `PUT {status:"active"}`, then re-read to confirm it reached `pending` |
| Registrar domain update | `PUT` returns `200` for any body but applies only `auto_renew`, `locked`, `privacy`. Unknown fields, including `ds_records`, are silently dropped |
| `PATCH /zones/:id/settings/:setting` | Unknown or removed settings are ignored, and the response echoes the *unchanged* value. Compare the returned value to what you sent |
| Bot management | `PATCH` returns `405 10405 Method not allowed for this authentication scheme`; use `PUT`. The AI-bot fields live here, not under `/settings` |

Related method quirks worth knowing: some bulk endpoints take an **array** as the
request body and reject a single object with `1001 invalid_json_body`.

## Free vs paid

Most Cloudflare features have a generous free tier; a handful are paid and a few
carry a fixed monthly cost even at zero usage. Read
`references/paid-features.md` before promising anything, and apply this rule:

- **Free, or metered with no fixed cost** — adopt it.
- **Fixed monthly cost** — do not enable it unasked. Report it as available and
  let the user decide.

Where a Security Center insight recommends something paid, say so plainly rather
than leaving the user to chase it. Those insights cannot be "fixed" on a free
plan.

## Safety rules (do not blanket-change)

These are the changes that look like hardening and are actually outages. Measure,
then decide — and get explicit sign-off where the change is not trivially
reversible.

- **HSTS.** `includeSubDomains` breaks every subdomain that is not HTTPS-capable,
  and browsers cache it for `max_age`. A too-long `max_age`, or `preload`, is
  effectively irreversible. Only enable `includeSubDomains` after confirming all
  subdomains serve HTTPS, and never set `preload` casually.
- **`browser_cache_ttl` and cache rules.** Origins frequently send correct
  `Cache-Control` already. Overriding it can serve stale HTML or one user's data
  to another. Never blanket-cache HTML or API responses; scope rules to
  content-hashed, immutable assets, and verify the origin's current header first.
- **SSL mode.** `full` → `full (strict)` requires a valid origin certificate.
  Changing it without checking breaks the site.
- **Orange-cloud proxying.** Do not proxy records to clear a
  `cname_record_not_proxied` insight. Third-party hosts frequently do not support
  it (Shopify storefronts, some SaaS TLS flows), and proxying interacts with the
  host's own certificate provisioning and HTTP-01 validation. Treat these as
  intentional until the user decides.
- **Rocket Loader, Auto Minify, and other JS-rewriting features.** They can break
  SPAs and modern bundlers. Enable only with a tested rollback path.
- **`security_level` → `under_attack`** is an emergency setting. Never leave it on.

Also worth checking before you trust a zone-level change: **is the hostname
actually proxied?** If the response has no `cf-ray` header, traffic reaches the
origin directly and no zone setting, rule, or transform applies — including
everything you just configured. Report this; it is often the reason "nothing
changed".

## Report format

Close with what changed, what was already fine, what is gated, and what needs the
user. Be concrete about evidence — a claim about a header or certificate should
come from a probe, not from the setting you just wrote.

```text
Summary: <what was audited, what was changed>
Changed: <per zone/account: setting or rule, old value -> new value>
Already optimal: <checked and left alone, with the measurement that justified it>
Gated by plan: <feature, tier required - not enabled>
Needs you: <DNS registrar steps, secrets to store, architecture decisions>
Verified: <probes run and their results>
```

## References

- `references/api-reference.md` — verified endpoint calls and payload shapes for
  every change above.
- `references/paid-features.md` — free-tier limits, plan gates, and which
  Security Center insights cannot be resolved for free.
- `scripts/audit.mjs` — read-only estate audit; run this first.
