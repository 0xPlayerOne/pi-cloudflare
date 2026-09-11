# Long-lived API token for the `api` server

Browser OAuth access lasts about an hour (refreshed silently while its own
grant survives). For automation that must never re-authenticate, use a
Cloudflare API token: it has no expiry and covers the whole `api` server,
whose `execute` tool proxies arbitrary `api.cloudflare.com` paths.

OAuth tokens cannot mint API tokens (they are audience-bound to their own
MCP issuer — verified: `400 Invalid format for Authorization header`), so
this is a one-time dashboard visit. Everything after it is code.

## 1. Create from the Workers template

My Profile (top-right avatar) → **API Tokens** → **Create Token** → start
from the **Edit Cloudflare Workers** template, which already includes:

- Workers Scripts Write, Workers KV Storage Write, Workers R2 Storage Write,
  Workers Tail Read, Workers Routes Write (Zone)
- Account Settings Read, User Details Read, User Memberships Read

## 2. Add what our tools need beyond the template

The standing scope is the **full free-feature audit set**: enough groups that an
agent can inventory and configure every free Cloudflare feature on an account
and all of its zones, plus read access to the paid surfaces so an audit can
report "not entitled" rather than "not permitted". The reference token carries
**141 groups** — 56 zone-scoped, 83 account-scoped, 2 user-scoped — split across
three policies exactly as below. A single policy mixing scopes fails with
`Failed common permission check`.

Live-proven 2026-09-11 as a bulk `PUT /user/tokens/:id` (secret preserved); the
groups below were diffed against the stored token afterward and all 141 landed.

### 2a. Zone-scoped (`com.cloudflare.api.account.zone.*`)

Include every managed zone under Zone Resources — not only the DNS zone.

| Domain                | Groups                                                                                                             | Why                                                                                                                                                                                |
| --------------------- | ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DNS + zone switches   | Zone Read; Zone Settings Read/Write; Zone DNS Settings Read/Write; DNS Write                                       | The largest free-feature lever: SSL mode, min TLS, HSTS, Brotli, HTTP/3, 0-RTT, Always Use HTTPS, cache level, DNSSEC and 30+ other settings are `PATCH /zones/:id/settings/*`     |
| Caching               | Cache Settings Read/Write; Cache Purge                                                                             | `http_request_cache_settings` rules, per-route edge/browser TTLs, and purge-on-deploy                                                                                              |
| Compression           | Response Compression Read/Write                                                                                    | `compress_response` rules. Built-in compression covers js/css/json/svg/wasm but omits `model/gltf-binary`, so GLBs ship raw — forced brotli measured 44% off (21.35 MB → 11.77 MB) |
| Transforms            | Zone Transform Rules Read/Write; Managed headers Read/Write                                                        | `http_response_headers_transform` / `http_request_transform`. The only way to set `Cache-Control` on Workers Static Assets responses — see `docs/workers-static-assets-caching.md` |
| Rules + redirects     | Dynamic URL Redirects Read/Write; Origin Read/Write; Config Settings Read/Write; Page Rules Read/Write             | Single redirects, origin rewrites, and the `http_config_settings` phase (free-tier rules that would otherwise need a Worker)                                                       |
| Edge code             | Snippets Read/Write                                                                                                | Free-tier edge snippets, a lighter alternative to a Worker for small header/redirect logic                                                                                         |
| Error responses       | Custom Errors Read/Write                                                                                           | Branded error pages instead of Cloudflare defaults                                                                                                                                 |
| Application security  | Zone WAF Read/Write; HTTP DDoS Managed Ruleset Read/Write; Bot Management Read/Write; Firewall Services Read/Write | WAF custom rules, managed ruleset overrides, bot fight mode, and the firewall access-rules list                                                                                    |
| Security insights     | Zone Security Center Insights Read/Write                                                                           | Resolving the Security Center recommendations that open the audit                                                                                                                  |
| Page Shield           | Domain Page Shield Read; Page Shield Write                                                                         | Client-side script/connection inventory (free tier reports; blocking needs paid)                                                                                                   |
| API Shield            | Domain API Gateway Read; Domain API Gateway                                                                        | API discovery — the free component of API Shield                                                                                                                                   |
| Observability         | Analytics Read; Zone Observability Read; Logs Read                                                                 | Zone analytics through GraphQL, zone telemetry, and log queries                                                                                                                    |
| TLS / certificates    | SSL and Certificates Read/Write                                                                                    | Certificate packs, edge certificates, and TLS posture                                                                                                                              |
| Delivery (paid, read) | Health Checks Read; Load Balancers Read; Waiting Rooms Read                                                        | Inventory + accurate "not on this plan" reporting without write exposure on paid products                                                                                          |
| Zero Trust (zone)     | Access: Apps and Policies Read                                                                                     | Zone-scoped Access application inventory                                                                                                                                           |
| Workers routing       | Workers Routes Read/Write                                                                                          | Route management for Workers on the zone                                                                                                                                           |
| AI Audit              | AI Audit Read/Write                                                                                                | Zone-level AI crawl/audit controls                                                                                                                                                 |
| Email routing         | Email Routing Rules Read/Write                                                                                     | Free email routing rules                                                                                                                                                           |

### 2b. Account-scoped (`com.cloudflare.api.account.*`)

| Domain                | Groups                                                                                                                                                                                                     | Why                                                                                                                                                                                                                                                                      |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Account settings      | Account Settings Read; Account DNS Settings Read/Write                                                                                                                                                     | Account-level DNS settings and account metadata                                                                                                                                                                                                                          |
| Rulesets              | Account Rulesets Read/Write; DDoS Protection Read                                                                                                                                                          | Account-level ruleset inventory                                                                                                                                                                                                                                          |
| Security insights     | Account Security Center Insights Read/Write; Application Security Reports Read                                                                                                                             | Resolving account-wide security recommendations                                                                                                                                                                                                                          |
| Storage: D1 / SQLite  | D1 Read/Write/Metadata Read                                                                                                                                                                                | SQLite databases — inventory, query, and migrations                                                                                                                                                                                                                      |
| Storage: R2           | Workers R2 Storage Read/Write/Metadata Read; Workers R2 Data Catalog Read/Write; Workers R2 SQL Read                                                                                                       | Bucket management, metadata, the R2 Data Catalog, and R2 SQL                                                                                                                                                                                                             |
| Storage: KV           | Workers KV Storage Read/Write                                                                                                                                                                              | KV namespace inventory and management                                                                                                                                                                                                                                    |
| Hyperdrive            | Hyperdrive Read/Write                                                                                                                                                                                      | Database connection pooling configs                                                                                                                                                                                                                                      |
| Workers runtime       | Workers Scripts Write; Workers Tail Read; Workers CI Write                                                                                                                                                 | Deploys, live tail, and build integration                                                                                                                                                                                                                                |
| Workers observability | Workers Observability Read/Write; Workers Observability Telemetry Write; Account Analytics Read; Logs Write                                                                                                | Usage rollups, telemetry writes, and **Logpush reads** (`GET /accounts/:id/logpush/jobs` — previously believed to need dashboard-only access; `Logs Write` unlocks it)                                                                                                   |
| Workers AI            | Workers AI Read/Metadata Read/Write; Vectorize Read/Write; AI Gateway Read/Write/Metadata Read                                                                                                             | Free-tier Workers AI, Vectorize indexes, and AI Gateway                                                                                                                                                                                                                  |
| Other compute         | Workers Containers Read; Browser Run Read; Pages Read/Write/Metadata Read; Queues Read/Write/Metadata Read                                                                                                 | Inventory of adjacent compute; Containers/Queues need a paid plan to act on                                                                                                                                                                                              |
| Images                | Images Read/Write/Metadata Read                                                                                                                                                                            | Image transformations, variants, and direct uploads                                                                                                                                                                                                                      |
| Zone-adjacent data    | Turnstile Sites Read/Write; Notifications Read/Write; Email Routing Addresses Read/Write; Email Routing Suppressions Read/Write                                                                            | Turnstile widgets, alerting policies, and email routing account data                                                                                                                                                                                                     |
| Zero Trust            | Zero Trust Read/Write; Access: Apps/ Policies/ Groups/ Identity Providers/ Service Tokens/ Device Posture/ Mutual TLS Certificates Read+Write; Access: Custom Pages/ Organizations/ Users/ Audit Logs Read | The full free-tier Zero Trust surface (free up to 50 seats)                                                                                                                                                                                                              |
| Tunnels               | Cloudflare Tunnel Read/Write                                                                                                                                                                               | `cloudflared` tunnel inventory and management                                                                                                                                                                                                                            |
| Registrar             | Registrar Domains Admin; Registrar Domains Read                                                                                                                                                            | Domain inventory, expiry, auto-renew, and transfer state. **Effectively read-only** — the API accepts only `auto_renew`/`locked`/`privacy` and exposes no DS/DNSSEC write, so publishing a DS record stays dashboard/registrar work (see `skills/cloudflare-hardening/`) |
| Secrets Store         | Secrets Store Read/Write                                                                                                                                                                                   | Programmatic secret storage (`secrets_store/*`). Free plan allows one store per account; the create endpoint takes a bulk array                                                                                                                                          |

### 2c. User-scoped (`com.cloudflare.api.user.<id>`)

| Groups                              | Why                                     |
| ----------------------------------- | --------------------------------------- |
| User Details Read; Memberships Read | Identity and account membership listing |

### Applying the scope

- **Dashboard:** every permission row needs all three dropdowns set (scope →
  permission → level); an unset level leaves the row invalid and blocks the
  builder. See `skills/cloudflare-api-token/SKILL.md`.
- **API (preferred for bulk changes):** `PUT /api/v4/user/tokens/:id` with the
  **complete** `{name, policies}`. It replaces rather than merges, so send the
  full intended set every time. From a dashboard tab this needs the dashboard's
  own write headers — see the SKILL's write-path note.
- Allow **2–3 minutes after a PUT** before concluding a group is missing.
  Immediately after the update, roughly a third of the newly granted endpoints
  still answer `403 Authentication error`; every one of them flipped to `200`
  within ~2 minutes. Probing too early produces false gaps.

### Not a permission problem (do not chase with token rows)

These answer `401`/`403` with an entitlement or quota message, so adding groups
will not help. Confirm by replaying the call with a full dashboard session: if
that also fails, it is the plan, not the token.

| Surface                                                          | Verdict                                                                     |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Cloudflare Containers                                            | `401` — requires the Workers **Paid** plan                                  |
| Workers for Platforms (dispatch)                                 | `403 10121` — paid/Enterprise product                                       |
| Spectrum                                                         | `403 10007` — paid product                                                  |
| Argo Smart Routing                                               | `401 1015` — paid zone setting (Tiered Caching reads fine and is free)      |
| Custom hostnames (SSL for SaaS)                                  | `403 1404` — no quota allocated; Enterprise product                         |
| Stream                                                           | `403` — paid product                                                        |
| Zone Analytics REST (`/analytics/dashboard`, `/analytics/colos`) | `404 1015` — **sunset for everyone**; use the GraphQL analytics API instead |
| Token self-management (`GET /user/tokens/:id` via the token)     | `9109` by design — API tokens cannot manage tokens                          |
| Logpush datasets (`/logpush/datasets`)                           | `404 10001` — no dataset catalog exposed to API tokens                      |
| Zone versions                                                    | `404 10001` — not exposed on the API token surface                          |

Worker Tail also needs a websocket — group presence plus the dashboard UI is the
check, not an API read.

## 3. Scope the accounts

Under Account Resources, include every account your agents manage (the
`api` server lists all accounts the token can see). Same for Zone Resources
if Workers Routes are in play. Copy the token **once** — it is shown a
single time.

## 4. Wire it in

```jsonc
// ~/.pi/agent/settings.json
{ "pi-cloudflare": { "apiToken": "${CLOUDFLARE_API_TOKEN}" } }
```

Export `CLOUDFLARE_API_TOKEN` in your shell profile. Native Pi also falls back
to the owner-only `~/.pi/cloudflare-api-token` file created by the token-roll
flow when the environment variable is unavailable. The `api` server then skips
OAuth entirely; the other four servers stay on browser OAuth.

## 5. Verify

```bash
CLOUDFLARE_API_TOKEN=<paste-once> node scripts/verify-api-token.mjs
```

Probes identity, membership, and one live read per audit domain across the
first discovered account and zone — including every ruleset phase, so a missing
group is named before an audit starts. Re-run any time agents report auth
trouble; it distinguishes a dead token from a scoping gap in seconds. It exits
non-zero only on `403` scope failures (see the status legend in the script), and
prints `plan` for entitlement-only surfaces so they are not mistaken for gaps.

## 6. Builder tips (learned the hard way)

- Every permission row has three dropdowns; an unset level leaves the row
  invalid and blocks the whole builder. Complete scope → permission → level
  per row and verify each commit before moving on. See
  `skills/cloudflare-api-token/SKILL.md` for the full standardized flow.
- The token secret is shown exactly once at creation and never returned by
  later reads. Capture it from the creation response; if missed, delete the
  token and recreate rather than hunting for it.
