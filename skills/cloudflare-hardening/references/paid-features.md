# Plan gates and paid features

Cloudflare's free tiers are generous and most hardening items cost nothing. This
file records which features are gated, so the audit does not chase a plan limit
with permission changes.

**Numbers change.** Fetch current limits from
`https://developers.cloudflare.com/` before quoting a quota or a price. The
plan *gates* below are the durable part; the figures are not.

## Gated on the Free plan

Confirmed by replaying each call with a full dashboard session — if the session
also fails, it is entitlement rather than token scope. These return an
entitlement or quota message, so **adding permission groups will not help**.

| Feature | Signal | Notes |
| --- | --- | --- |
| Argo Smart Routing | `401 1015` | Paid zone setting, fixed monthly cost |
| Polish / Mirage / WebP | `editable: false` on the setting | Paid image optimizations |
| Image Transformations / Images | `allowed: 0` on `/accounts/:id/images/v1/stats` | Needs a paid Images plan |
| Snippets | `403 snippets are not allowed` | Free-plan-disabled; rules out serving small responses like `security.txt` |
| Containers | `401` | Requires the Workers Paid plan |
| Workers for Platforms (dispatch) | `403 10121` | Paid/Enterprise |
| Spectrum | `403 10007` | Paid |
| Stream | `403` | Paid |
| Load Balancing, Health Checks, Waiting Rooms | Paid | Read access still works for inventory |
| Custom hostnames (SSL for SaaS) | `403 1404` | No quota allocated; Enterprise |
| Logpush jobs (account) | `401` without `Logs Write` | This one is a **scope** gap, not a plan gate — grant `Logs Write` and it works |

Two zone settings are not merely gated but **deprecated**:

- `waf` → `400 WAF is deprecated for this zone, Managed Rulesets should be used
  instead.` Use the managed ruleset entrypoint instead.
- `minify` → accepts the PATCH and returns `200` with the value unchanged. Treat
  auto-minify as unavailable and minify at build time.

## Free-tier features worth adopting

Everything here is free or metered with no fixed monthly cost, which makes it
safe to enable without a spending decision:

- TLS 1.2+ minimum, Always Use HTTPS, automatic HTTPS rewrites, TLS 1.3 with 0-RTT
- HTTP/2, HTTP/3, Brotli, Early Hints, WebSockets
- The **managed WAF ruleset** (a fixed CVE signature set)
- Custom WAF rules and rate limiting (metered)
- DNSSEC, HSTS, `security.txt` via a zone rule or the app
- Page Shield reporting, API discovery, bot fight mode, AI-bot blocking
- Cache rules, compression rules, response-header transform rules, origin rules,
  config rules, single redirects, page rules
- Workers, KV, D1, R2 (with egress-free reads), Hyperdrive, Queues
- Zero Trust Access (free up to a seat cap), Cloudflare Tunnel
- Turnstile, Web Analytics, Workers AI, Vectorize, AI Gateway, Secrets Store

## Security Center insights that cannot be resolved for free

Security Center recommends things the current plan may not include. Report these
as gated rather than leaving the user to chase them, and note that dismissing an
insight is a legitimate way to clear it when the recommendation does not apply:

| Insight | Why it cannot be actioned |
| --- | --- |
| `argo_smart_routing_not_enabled` | Paid feature with a fixed monthly cost |
| `polish_not_enabled` | Paid zone setting |
| `cname_record_not_proxied` | Usually intentional — see the proxying note below |
| `security_txt_not_enabled` | No public API, and Snippets are Free-plan-disabled. Needs a Workers route, a zone rule, or the app itself to serve the file |

Insights also re-evaluate on Cloudflare's schedule (roughly daily), so a correct
fix will not clear the insight immediately. Do not re-apply a change because the
insight is still listed.

## Two cost shapes

When judging whether to enable something, distinguish:

- **Metered, no fixed cost** — free until a usage threshold, then billed per unit.
  Safe to enable; the failure mode is a surprise bill only at high volume.
- **Fixed monthly cost** — billed whether or not it is used (Argo, Polish,
  Load Balancing, and similar). Do not enable these during an audit. Report them
  as available and let the user make the call.

## Not a Cloudflare setting

Two common hardening items have no API and belong to the application or the
registrar:

- **`security.txt`** — serve it from the app's static assets or a Workers route.
  There is no API for it (Security Center exposes only insights, classification,
  severity, type, audit-log, and context endpoints).
- **DNSSEC DS records** — published at the registrar, not by API. See
  `api-reference.md`.
