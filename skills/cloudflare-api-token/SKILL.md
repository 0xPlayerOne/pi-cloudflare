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

## UI fast path

1. My Profile (avatar) → API Tokens → Create Token → start from the template the task needs (usually Edit Cloudflare Workers).
2. Add each extra group with Add more → permission box: click it, `type_text` to filter, ArrowDown + Enter to commit (trusted keystrokes commit reliably; synthetic DOM clicks can look committed while leaving the row invalid).
3. Level box: click its combobox uid, ArrowDown + Enter on the option. If the menu opens empty, the permission did **not** really commit — redo step 2, do not proceed.
4. Account Resources: Include + every managed account. Zone Resources: include (needed for Workers Routes). Leave Client IP filtering off and TTL unset unless the task says otherwise.
5. Continue to summary → **read back the full permission/resource list** → only then Create.
6. The secret is shown **once**. A later GET never returns it — if you miss it, delete the token and recreate.

## API fast path (when the UI fights)

Same-origin `/api/v4/*` in page context carries the session:

- `GET /api/v4/user/tokens/permission_groups?per_page=100` — resolve every group by exact name first (`D1 Write`, not `D1 Edit`). All ~400 come back in one page.
- Mirror an existing token's policy split (`GET /api/v4/user/tokens`): zone-scoped groups under `com.cloudflare.api.account.zone.*`, user groups under `com.cloudflare.api.user.<id>`, account groups per account id (or the account wildcard). A single policy mixing scopes fails with `Failed common permission check`.
- `POST /api/v4/user/tokens` with `{name, policies}` → capture `result.value` from **that** response.
- Verify with the token itself (`GET /user`, one scoped read per new group), hand the secret over once, destroy every local copy (`chmod 600` while it lives, then delete). Rollback is delete + recreate.

## React-select mechanics (dash dropdowns)

- Menus open on control mousedown, not input click; options may expose no a11y role until open — snapshot after opening, act on fresh uids only.
- Never reuse coordinates across scrolls or snapshots: annotate → click immediately, then re-verify. Stale-coordinate clicks land on neighboring ✕ buttons and delete finished rows.
- `evaluate_script` DOM clicks can set display text without committing React state. Treat `value=` in a snapshot as necessary but not sufficient — sufficiency is the level menu opening with real options.

## After creation

- Run `CLOUDFLARE_API_TOKEN=<paste-once> node scripts/verify-api-token.mjs` (identity, token status, Workers scripts read).
- Template drift is real: the dashboard template grows over time (Builds/Agents/Containers/Observability/Pages appeared after the doc was written). Enumerate required groups per task from `docs/api-token.md`; never assume the template equals the need.
- A 403 naming a missing group later means extend-then-verify, not a new token: same flow, one more row.
