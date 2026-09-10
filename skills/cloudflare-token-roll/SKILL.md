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
6. **Store it through the active host's secret mechanism — never put the literal in repository configuration.**
   - **Native Pi:** write `export CLOUDFLARE_API_TOKEN="<secret>"` to `~/.pi/cloudflare-api-token` (mode `0600`); ensure `~/.zshrc` sources it inside the marked idempotent block; set `~/.pi/agent/settings.json` → `pi-cloudflare.apiToken` to the literal reference `${CLOUDFLARE_API_TOKEN}`; preserve every other setting; then verify a fresh shell and one live API read.
   - **Agent Plugin:** Agent Plugins 1.0 has no portable secret-reference field. Store the value with the client's own secret/environment facility so the plugin MCP subprocess receives `CLOUDFLARE_API_TOKEN`. Do not write the API token into `${PLUGIN_DATA}` yourself; that directory is reserved here for the package-managed browser OAuth token store. Restart or reload the plugin if the client only snapshots environment at process launch, then verify one live API read.
   - **Unknown host:** stop before writing. Ask where that client stores MCP environment secrets; never guess a Pi path.
7. Destroy temporary copies. Report stored + verified **without printing the secret**.

## What success looks like

- Exactly one active token under the expected name (list and check for duplicates — a failed first attempt often leaves one behind).
- `modified_on` bumped, old secret rejected (spot-check one call with it only if exposure is suspected; otherwise just rotate wiring).
- The active host can resolve the new token after a fresh MCP/session start and one live scoped read succeeds.
- Never retry-loop the confirm dialog. One confirm, one capture.
