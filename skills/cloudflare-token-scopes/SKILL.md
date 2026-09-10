---
name: cloudflare-token-scopes
description: Add, remove, or change permission scopes on an existing Cloudflare API token. Use when a 403 names a missing permission group, when new tools need new groups, or when trimming an over-scoped token. Prefers the PUT update path (secret preserved) over delete-and-recreate.
---

# Cloudflare Token Scope Updates

Prefer updating in place: the secret survives, wiring stays intact, and the change is one auditable diff. Delete-and-recreate (or roll) is only for lost secrets and suspected exposure — see cloudflare-token-roll.

## Discover the current state first

- `GET /api/v4/user/tokens` → find the token id by name.
- `GET /api/v4/user/tokens/:id` → full policies (resources + groups). Never returns the secret — safe to log and diff.
- A 403 from an agent tool names the missing group (`Failed common permission check` or the dashboard equivalent). That name, not guesswork, drives the change.

## Resolve groups by exact name

- `GET /api/v4/user/tokens/permission_groups?per_page=100` returns all ~400 in one page.
- UI verbs map to API verbs: UI `Edit` = API `Write`, UI `Read` = API `Read` (e.g. UI `D1` level Edit → `D1 Write`).
- Never invent group names. If a dashboard label has no exact API match (template labels drift ahead of the API), stop and surface the candidates — do not approximate on a credential.

## Update via PUT (secret preserved)

- `PUT /api/v4/user/tokens/:id` with the **complete** new `{name, policies}` — it replaces, so send the full intended set: keep existing groups, add or drop the target ones.
- Split policies by scope exactly like creation: zone-scoped groups under `com.cloudflare.api.account.zone.*`, user groups under `com.cloudflare.api.user.<id>`, account groups per account (explicit ids or the account wildcard). A mixed-scope policy fails with `Failed common permission check`.
- Same-origin `/api/v4/*` in page context carries the session (persistent browser, headed for dashboard pages). `Content-Type: application/json` required.
- Verify after: re-GET the token and diff policies, then exercise one live read per changed group. A 403 afterward means the group mapping was wrong, not the mechanism.

## When you cannot self-serve: hand off with the exact spec

PUT needs a token that can manage tokens (API tokens get `9109` by design),
and the dashboard path needs a headed browser plus a human for Turnstile.
When neither is available, do not guess — hand the human the exact row to
add:

- Derive the group from the failing call, not from memory: the tool plus
  endpoint determines it (e.g. `/accounts/{id}/builds/*` → Workers Builds
  Configuration).
- Derive the level from the HTTP method: GET → Read, anything else → Edit.
- Include the scope: account-scoped groups need every managed account
  included under Account Resources.
- Format it as dashboard rows so the human pastes without translating:
  `Account | Workers Builds Configuration | Edit`, one line per row, exact
  labels.

## When update is the wrong tool

- Secret lost or leaked → cloudflare-token-roll (no public roll route; UI flow).
- Token for a different identity or account set → create fresh (cloudflare-api-token), then delete the old one only after the new wiring verifies.
