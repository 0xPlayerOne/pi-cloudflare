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

## React-select mechanics (dash dropdowns)

- Menus open on control mousedown, not input click; options may expose no a11y role until open — snapshot after opening, act on fresh uids only.
- Never reuse coordinates across scrolls or snapshots: annotate → click immediately, then re-verify. Stale-coordinate clicks land on neighboring ✕ buttons and delete finished rows.
- `evaluate_script` DOM clicks can set display text without committing React state. Treat `value=` in a snapshot as necessary but not sufficient — sufficiency is the level menu opening with real options.

## After creation: validation matrix (live-proven 2026-09-06)

- Run `CLOUDFLARE_API_TOKEN=<paste-once> node scripts/verify-api-token.mjs` (identity, token status, Workers scripts read).
- Then one live read per relied-upon group, all passing on the reference token: `GET /user`, `GET /accounts`, Workers scripts list, KV namespaces list, R2 buckets list, D1 databases list, Hyperdrive configs list, zones list, zone routes list, account read, memberships list, audit-logs list (proves Logs Read).
- Known non-gaps, do not chase: `GET /user/tokens/:id` returns `9109` by design (tokens cannot manage tokens); zone-analytics `10000` without the Zone Analytics group is correct least privilege (observability rollups go through the separate obs MCP, not this token); Workers Tail needs a websocket (group presence + dashboard UI is the check).
- Workers Builds (live-proven 2026-09-07): `GET /accounts/{id}/builds/builds/{uuid}` plus `/logs` read; trigger PATCH and build-token DELETE verified with the Edit level.
- Template drift is real: the dashboard template grows over time (Builds/Agents/Containers/Observability/Pages appeared after the doc was written). Enumerate required groups per task from `docs/api-token.md`; never assume the template equals the need.
- A 403 naming a missing group later means extend-then-verify, not a new token: same flow, one more row.
