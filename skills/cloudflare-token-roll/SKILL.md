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
3. The secret modal (`Token rolled successfully` / `Copy your API token now`) holds the **only copy**. Capture `cfut_...` immediately.
4. Click Done. Verify the token row still shows Active.
5. Validate before handoff: `GET /user` (identity), one scoped read per newly relied-upon group (see cloudflare-api-token skill matrix). `GET /user/tokens/:id` confirming policies is safe (never returns the secret).
6. **Store it for them — never hand off manual steps.** The user must not need to touch anything:
   - Write `export CLOUDFLARE_API_TOKEN="<secret>"` to `~/.pi/cloudflare-api-token` (mode `0600`, no other content that matters).
   - Ensure `~/.zshrc` sources it inside a marked idempotent block (`# >>> pi-managed: cloudflare-api-token >>>` … `# <<< pi-managed: cloudflare-api-token <<<`), replacing any previous block.
   - Set `~/.pi/agent/settings.json` → `pi-cloudflare.apiToken` to the literal string `${CLOUDFLARE_API_TOKEN}` (reference, never the secret). Preserve every other key byte-for-byte in meaning.
   - Verify: fresh interactive shell resolves a 53-char value; settings parses; one live API read succeeds.
   - Tell the user to open a new terminal (or `source ~/.zshrc`) and restart Pi sessions so the new environment is picked up.
7. Destroy temp copies. Report stored + verified **without printing the secret**.

## What success looks like

- Exactly one active token under the expected name (list and check for duplicates — a failed first attempt often leaves one behind).
- `modified_on` bumped, old secret rejected (spot-check one call with it only if exposure is suspected; otherwise just rotate wiring).
- Never retry-loop the confirm dialog. One confirm, one capture.
