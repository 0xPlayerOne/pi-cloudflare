---
name: cloudflare-api-token
description: Create, scope, verify, and rotate Cloudflare dashboard API tokens for agents. Use when a task needs a long-lived token with specific permission groups, when extending token scope for new tools, or when agents report 403s that name a missing permission group. Covers the UI builder flow, the same-origin API fast path, and secret hygiene.
---

# Cloudflare API Token Creation

OAuth tokens cannot mint API tokens (audience-bound — verified `400`), so this is a dashboard flow. See also `docs/api-token.md` for the standing permission table.

## Session setup (non-negotiable)

- Persistent browser, **headed**. `dash.cloudflare.com` serves an interactive Turnstile challenge to headless sessions even with a valid login — do not attempt this fresh or headless.
- Confirm the Cloudflare login is live first (dashboard home renders, not a challenge or login wall). If not, run the headed auth flow and have the human sign in before touching the builder.

## The rule that runs the whole flow

Every permission row has **three** dropdowns: scope | permission | **level**. A row with an unset level stays invalid (`Choose a permission`), and an invalid row blocks everything downstream — no further rows, no summary. **Complete all three dropdowns on each row and verify the commit in a fresh snapshot before moving to the next row.** Never batch assumed successes.

- UI `Edit` = API `Write`. UI `Read` = API `Read`.
- Commit check per row: snapshot shows `value="<Group>"`, the level shows `Edit`/`Read` (not `Select...`), and no error text sits under the row.

## UI fast path (batched, not step-verified)

Move fast row by row. One snapshot per row to learn its uids, then drive its controls without re-reading until the row is done. Each permission is four quick steps:

1. Click **Add more** (fresh uid — rows shift uids on every structural change).
2. Scope: leave `Account` unless the task needs otherwise.
3. Permission box: click it, `type_text` to filter, ArrowDown + Enter to commit. Trusted keystrokes commit reliably; synthetic DOM clicks can look committed (`value=` set) while leaving the row invalid — prefer keystrokes.
4. Level box: click its combobox, ArrowDown + Enter on Edit/Read. UI `Edit` = API `Write`.

Do not snapshot between steps 1–4. Piggyback verification for free: the next row's snapshot shows the previous row's committed state — glance at it while grabbing the next row's uids. If a level menu opens empty, that row's permission did **not** really commit — redo its step 3 on the spot, then resume speed.

Then, once, at the end:

5. Account Resources: Include + every managed account. Zone Resources: include (needed for Workers Routes). Leave Client IP filtering off and TTL unset unless the task says otherwise.
6. Screenshot the whole builder and **read back every row** (scope + permission + level). Missing or `Select...` rows get added/fixed now, before proceeding — never after Create.
7. Continue to summary → confirm the summary matches the read-back → Create.
8. The secret is shown **once**. A later GET never returns it — capture immediately (roll skill covers recovery).

Hiccup protocol: on any failure (stale uid, empty menu, vanished row), take one screenshot plus one fresh snapshot, resolve from what you actually see, and continue. Never retry-loop blindly, and never batch assumed successes across a failure — re-verify that row, then resume speed.

## API fast path (when the UI fights)

Same-origin `/api/v4/*` in page context carries the session:

- `GET /api/v4/user/tokens/permission_groups?per_page=100` — resolve every group by exact name first (`D1 Write`, not `D1 Edit`). All ~400 come back in one page.
- Mirror an existing token's policy split (`GET /api/v4/user/tokens`): zone-scoped groups under `com.cloudflare.api.account.zone.*`, user groups under `com.cloudflare.api.user.<id>`, account groups per account id (or the account wildcard). A single policy mixing scopes fails with `Failed common permission check`.
- `POST /api/v4/user/tokens` with `{name, policies}` → capture `result.value` from **that** response.
- Verify with the token itself (`GET /user`, one scoped read per new group — full matrix below), hand the secret over once, destroy every local copy (`chmod 600` while it lives, then delete). Rollback is dashboard roll, not delete + recreate (there is no public roll route — see `skills/cloudflare-token-roll/SKILL.md`).

## Bulk scope changes: PUT, and the write-path trap

`PUT /api/v4/user/tokens/:id` replaces the whole policy set, so build the new
`{name, policies}` by **merging** current groups with the additions and diffing
the read-back afterward. The secret survives, so there is no re-wiring.

Two traps make this fail in ways that look like a permissions bug:

- **Writes are WAF-challenged without the dashboard's own headers.** `PUT` /
  `POST` from page context returns `403` with `content-type: text/html` and a
  "Just a moment..." body, while `GET` on the same URL returns `200`. Add the
  first-party write headers to any mutating call:

  ```js
  headers: {
    'Content-Type': 'application/json',
    Origin: 'https://dash.cloudflare.com',
    Referer: 'https://dash.cloudflare.com/profile/api-tokens',
    'X-Cross-Site-Security': 'dash',
  }
  ```

  A `403` that is HTML is the challenge; a `403` that is JSON is a real scope
  error. Check `content-type` before diagnosing.

- **A successful PUT takes ~2–3 minutes to propagate.** Immediately after
  updating, roughly a third of the newly granted endpoints still answer
  `403 Authentication error`; all of them flipped to `200` within ~2 minutes
  (measured 2026-09-11 across 13 endpoints, four probes over 135s, stable from
  the first probe onward). Do not re-PUT or conclude a group mapping is wrong
  during that window — sleep, then re-probe.

## React-select mechanics (dash dropdowns)

- Menus open on control mousedown, not input click; options may expose no a11y role until open — snapshot after opening, act on fresh uids only.
- Never reuse coordinates across scrolls or snapshots: annotate → click immediately, then re-verify. Stale-coordinate clicks land on neighboring ✕ buttons and delete finished rows.
- `evaluate_script` DOM clicks can set display text without committing React state. Treat `value=` in a snapshot as necessary but not sufficient — sufficiency is the level menu opening with real options.

## After creation: validation matrix (live-proven 2026-09-06)

- Run `CLOUDFLARE_API_TOKEN=<paste-once> node scripts/verify-api-token.mjs` (identity, token status, Workers scripts read).
- Then one live read per relied-upon group, all passing on the reference token: `GET /user`, `GET /accounts`, Workers scripts list, KV namespaces list, R2 buckets list, D1 databases list, Hyperdrive configs list, zones list, zone routes list, account read, memberships list, audit-logs list (proves Logs Read), `GET /accounts/{id}/workers/observability/usage` with millisecond-epoch `from`/`to` (proves Workers Observability Read — live-proven 2026-09-10 on both accounts).
- Zone Cache Rules Edit (only when granted): `GET /zones/:id/rulesets/phases/http_request_cache_settings/entrypoint` — expect `200` with the entrypoint, or `10003` (no entrypoint yet) which also proves the group is present. Live-proven 2026-09-09: created zone rule `landing-marketplace-edge-300s` (`http.host eq "pinkbinder.shop" and starts_with(http.request.uri.path, "/api/marketplace")`, edge+browser TTL 300s override-origin) after adding this group.
- Zone Response Compression Edit (live-proven 2026-09-11): `PUT /zones/:id/rulesets/phases/http_response_compression/entrypoint` succeeds; a `403 request is not authorized` means the group is absent. Worth having because Cloudflare's built-in compression omits `model/gltf-binary`, so GLB payloads otherwise ship raw — forced brotli measured 44% off (21.35 MB → 11.77 MB across a scene catalogue). Verify on a real hostname: zone rules do **not** apply to `*.workers.dev`, which bypasses the zone.
- Zone Transform Rules Edit (live-proven missing 2026-09-11): `PUT /zones/:id/rulesets/phases/http_response_headers_transform/entrypoint`. This is the **only** way to change `Cache-Control` on Workers Static Assets responses — `_headers` files are ignored and zone Cache Rules do not apply. See `docs/workers-static-assets-caching.md`. The same group gates single redirects (`http_request_dynamic_redirect`).
- Zone DNS Edit (live-proven missing 2026-09-11): `GET /zones/:id/dns_records` — `403 Authentication error` means absent. Needed for apex/subdomain cutovers; note that attaching a Workers **custom domain** does *not* require it (that works through `wrangler deploy` with a `custom_domain` route), so a missing DNS group is not a blocker for that specific move.
- Full audit set (live-proven 2026-09-11, one bulk PUT, all 137 groups verified stored and exercised): the merge-safe probe set is one read per new domain — `GET /zones/:id/settings` (Zone Settings), `/zones/:id/pagerules` (Page Rules), `/zones/:id/snippets` (Snippets), `/zones/:id/healthchecks` (Health Checks), `/zones/:id/waiting_rooms`, `/zones/:id/bot_management`, `/zones/:id/page_shield/scripts`, `/accounts/:id/rulesets` (Account Rulesets), `/accounts/:id/security-center/insights` (Security Center Insights), `/accounts/:id/dns_settings`, `/accounts/:id/images/v1`, `/accounts/:id/ai/models/search`, `/accounts/:id/vectorize/v2/indexes`, `/accounts/:id/pages/projects`, `/accounts/:id/access/groups`, `/accounts/:id/gateway`, `/accounts/:id/devices/posture`, `/accounts/:id/logpush/jobs`. **`Logs Write` unlocks `GET /accounts/:id/logpush/jobs`** — the earlier "Logpush 401s, dashboard only" note in this file was wrong; it was a missing group, not a missing surface.
- Disambiguate plan gates from scope gaps by replaying the failing call with the **full dashboard session** (no token). If the session also fails, it is entitlement, not scope. Confirmed entitlement-only surfaces (2026-09-11): Containers (`401`, Workers Paid), Workers for Platforms dispatch (`403 10121`), Spectrum (`403 10007`), Argo Smart Routing (`401 1015`), SSL for SaaS custom hostnames (`403 1404`, no quota), Stream (`403`). Also sunset for everyone: the Zone Analytics REST API (`404 1015` — use GraphQL).
- Operator entitlements are plan-gated and fail with an explicit message, not a silent no-match: `matches` (regex) needs a Business or WAF Advanced plan (`not entitled: the use of operator Matches is not allowed`), while `in`, `eq`, `starts_with`, `extension`, `len`, and `substring` work on Free. Prefer those when authoring rules for a free zone.
- Known non-gaps, do not chase: `GET /user/tokens/:id` returns `9109` by design (tokens cannot manage tokens); zone-analytics `10000` without the Zone Analytics group is correct least privilege (observability rollups go through the separate obs MCP, not this token); Workers Tail needs a websocket (group presence + dashboard UI is the check); Logpush **datasets** (`404 10001`) and Zone versions (`404 10001`) expose no API-token surface. Workers custom-domain endpoints (`/accounts/{id}/workers/domains`) answer `405 Method not allowed for this authentication scheme` for both API tokens and the wrangler OAuth token — manage custom domains through `wrangler deploy` routes, not this endpoint.
- Workers Builds (live-proven 2026-09-07): `GET /accounts/{id}/builds/builds/{uuid}` plus `/logs` read; trigger PATCH and build-token DELETE verified with the Edit level.
- Template drift is real: the dashboard template grows over time (Builds/Agents/Containers/Observability/Pages appeared after the doc was written). Enumerate required groups per task from `docs/api-token.md`; never assume the template equals the need.
- A 403 naming a missing group later means extend-then-verify, not a new token: same flow, one more row.
