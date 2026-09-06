---
name: cloudflare-auth-setup
description: Set up Cloudflare authentication from any state. Use before any Cloudflare task when auth is unknown, expired, or rejected; when choosing between a persistent API token and temporary browser OAuth; or when the environment may lack browser automation. Routes to token creation, OAuth, or manual fallback.
---

# Cloudflare Auth Setup (Router)

This skill runs **before** any Cloudflare work when authentication is not already proven. Never guess at credentials and never loop a rejected auth wall — triage, ask once, then set up exactly one path.

## Step 0 — What state are we in?

Check in order, stop at the first hit:

1. **API token configured?** `pi-cloudflare.apiToken` setting (or `CLOUDFLARE_API_TOKEN` env) present → verify with one cheap read (`GET /user`). Works → done, proceed with the task.
2. **Browser OAuth fresh?** Stored tokens exist and unexpired (or a silent refresh succeeds) → done.
3. **Otherwise → unauthenticated.** Go to Step 1. This includes expired/revoked tokens and any 401/403/`invalid_grant` from a tool call.

## Step 1 — Stop and ask (one question, three options)

Do not pick for the user. Ask:

> Cloudflare isn't authenticated. How should I set it up?
> 1. **API token (recommended for repeat work)** — I create it in your dashboard, store it, verify it. Survives restarts, no browser popups afterward.
> 2. **Browser OAuth (quickest for one-off work)** — you approve once in a browser window; lasts about an hour.
> 3. **I'll paste a token** — you create it in the dashboard yourself and hand me the value; I store and verify it.

If the user already answered implicitly ("just set it up", "use a token"), skip the question and proceed — note the assumption.

## Step 2 — Check what this environment can do

| Capability | How to tell | If missing |
|---|---|---|
| Drive a browser (`browser_*` tools or equivalent) | Tool list contains browser automation | Token creation becomes **guided manual**: give exact dashboard clicks (see cloudflare-api-token skill UI path), user pastes the secret back, you store + verify. OAuth becomes **manual**: user runs the setup command in their own terminal. |
| Open a terminal for the setup CLI | You can execute shell | Otherwise do everything in-chat: manual dashboard steps + paste-back. |
| Existing dashboard session | Previous browser profile with a login | Without it, every browser path starts with a human sign-in (SSO/2FA/passkeys are theirs to complete). |

The matrix composes: no browser + no terminal still works (pure manual + paste-back). Never declare the task impossible — degrade to the manual path with precise steps.

## Step 3 — Execute exactly one path

- **API token** → `cloudflare-api-token` skill (create), including its store step (env file + shell block + settings reference + verify). On a lost secret later: `cloudflare-token-roll`. On scope changes: `cloudflare-token-scopes`.
- **Browser OAuth** → run the per-server setup command from the error hint (`pi-cloudflare-setup --only <server>`); the human approves in the opened window. Re-verify with one cheap read. Warn that it expires in about an hour.
- **Pasted token** → store exactly like a created one (same store step, same file perms), verify, destroy chat-visible copies from your side (never write the value to repo files, logs, or docs).

## Step 4 — Prove it before the real task

One cheap read in the task's domain (identity, one list call). Only then continue. If it fails, you misdiagnosed Step 0 — restart triage instead of retry-looping.

## Rules

- One auth question per session unless the state changes; remember the answer.
- Secrets: `chmod 600` while they live, settings hold references (`${...}`) never literals, temp copies destroyed, values never land in repos, issues, or docs.
- A 403 naming a missing group after setup is a scoping task (`cloudflare-token-scopes`), not an auth failure — do not restart triage.
