---
name: cloudflare-token-roll
description: Roll a Cloudflare dashboard API token when its secret is lost or may be exposed. Use when the stored secret is missing, when a token may have leaked, or when validation needs a capturable value. Covers the UI roll flow, secret capture, verification, and handoff. There is no public roll API route — this is UI-driven by design.
---

# Cloudflare Token Roll

There is no public roll endpoint (`POST /user/tokens/:id/roll` returns `7000 No route`). Roll happens in the dashboard: token row Actions menu → Roll → confirm dialog → **secret modal shows the new value once**. A later GET never returns it.

## Preconditions

- Persistent browser, **headed** (dashboard challenges headless). Never fresh.
- Confirm with the user first: rolling **kills the current secret immediately**. Only roll when the old value is unused, lost, or compromised. If it is wired anywhere, that wiring breaks at confirm time.

## Flow

1. My Profile → API Tokens → token row Actions → Roll.
2. Menu interaction notes: open the Actions menu, then drive the dialog with DOM clicks if a11y clicks stall (dialog buttons sometimes need `querySelector` + `.click()` while a11y clicks dismiss). Confirm only the intended token (dialog names it — read it back before confirming).
3. The secret modal (`Token rolled successfully` / `Copy your API token now`) holds the **only copy**. Capture `cfut_...` immediately without printing it in chat or logs.
4. Click Done. Verify the token row still shows Active.
5. Validate before handoff: `GET /user` (identity), one scoped read per newly relied-upon group (see cloudflare-api-token skill matrix). `GET /user/tokens/:id` confirming policies is safe (never returns the secret).
6. **Store it where the tools read it — never put the literal in repository configuration.** Write `export CLOUDFLARE_API_TOKEN="<secret>"` to the environment file the host sources (the estate uses `~/.pi/cloudflare-api-token`, mode `0600`), or export it in the session; then verify one live API read (`cf auth whoami`).
7. Destroy temporary copies. Report stored + verified **without printing the secret**.

## What success looks like

- Exactly one active token under the expected name (list and check for duplicates — a failed first attempt often leaves one behind).
- `modified_on` bumped, old secret rejected (spot-check one call with it only if exposure is suspected; otherwise just rotate wiring).
- A fresh shell resolves the new token and one live scoped read succeeds.
- Never retry-loop the confirm dialog. One confirm, one capture.
