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

In the same builder, add these permission groups:

| Group                              | Why                                                                                                                                                                 |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Workers D1 Storage Write           | `d1_*` tools (databases, query)                                                                                                                                     |
| Hyperdrive Write                   | `hyperdrive_*` tools (configs)                                                                                                                                      |
| Account Analytics Read             | `query_worker_observability` rollups                                                                                                                                |
| Logs Read                          | log queries                                                                                                                                                         |
| Workers Builds Configuration Write | `workers_builds_*` tools (trigger PATCH + build-token DELETE need Edit, not just Read — verified 2026-09-07)                                                        |
| Zone Cache Rules Edit              | zone Cache Rules read/write (zone-scoped; add only when agents manage `http_request_cache_settings`, e.g. per-route edge TTLs like `landing-marketplace-edge-300s`) |
| Workers Observability Read         | `GET /accounts/{id}/workers/observability/usage` reads (Account scope; live-proven 2026-09-10 on both accounts)                                                     |

Skip Zone/DNS, Queues, and AI Gateway unless agents start managing them —
403s name the missing group, and the extension surfaces them verbatim. Zone
Cache Rules Edit stays opt-in (zone-scoped): grant it only when agents manage
`http_request_cache_settings`.

Known non-gaps (do not chase with this token): Logpush jobs
(`GET /accounts/{id}/logpush/jobs` 401s — no Logpush group is exposed to API
tokens; manage Logpush in the dashboard) and the token-management endpoints
themselves (`9109` by design). Worker Tail also needs a websocket — group
presence plus the dashboard UI is the check, not an API read.

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

Checks identity (`/user`), token status, and a Workers scripts read. Re-run
any time agents report auth trouble — it distinguishes a dead token from a
scoping gap in seconds.

## 6. Builder tips (learned the hard way)

- Every permission row has three dropdowns; an unset level leaves the row
  invalid and blocks the whole builder. Complete scope → permission → level
  per row and verify each commit before moving on. See
  `skills/cloudflare-api-token/SKILL.md` for the full standardized flow.
- The token secret is shown exactly once at creation and never returned by
  later reads. Capture it from the creation response; if missed, delete the
  token and recreate rather than hunting for it.
