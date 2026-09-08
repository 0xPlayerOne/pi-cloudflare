---
name: cloudflare-auth-setup
description: Set up Cloudflare authentication from any state. Use before any Cloudflare task when auth is unknown, expired, or rejected; when choosing between a persistent API token and temporary browser OAuth; or when the environment may lack browser automation. Routes to token creation, OAuth, or manual fallback.
---

# Cloudflare Auth Setup (Router)

This skill runs **before** Cloudflare work when authentication is not already proven. Never guess at credentials and never loop a rejected auth wall — triage, ask once, then set up exactly one path. The package can run as native Pi or as an Agent Plugin, so never assume a `~/.pi` path unless the host is actually Pi.

## Step 0 — What state are we in?

Check in order, stop at the first hit:

1. **API access already works?** Verify with one cheap `cf_api_*` read. A native Pi host may source this from `pi-cloudflare.apiToken`; an Agent Plugin host may inject `CLOUDFLARE_API_TOKEN` through its own secret/environment mechanism. Do not inspect or print the secret.
2. **Browser OAuth already works?** Run one cheap tool in the required `cf_<server>_*` namespace. Silent refresh is automatic when stored credentials are usable.
3. **Otherwise → unauthenticated.** Go to Step 1. This includes expired/revoked tokens and any 401/403/`invalid_grant` from a tool call.

## Step 1 — Stop and ask (one question, three options)

Do not pick for the user. Ask:

> Cloudflare isn't authenticated. How should I set it up?
> 1. **API token (recommended for repeat automation)** — create a scoped token, store it through this host's secret mechanism, then verify it.
> 2. **Browser OAuth (quickest)** — run the exact re-authentication command returned by the Cloudflare tool and approve once in a browser.
> 3. **I already have a token** — enter it locally through the host's secret/environment mechanism, never in chat, then verify it.

If the user already answered implicitly (for example, "use OAuth" or "use a token"), skip the question and proceed while noting the assumption.

## Step 2 — Check what this environment can do

| Capability | How to tell | If missing |
|---|---|---|
| Drive a browser (`browser_*` tools or equivalent) | Tool list contains browser automation | Token creation becomes guided manual: give exact dashboard clicks from `cloudflare-api-token`. OAuth still works by having the user run the returned setup command in their own terminal. |
| Open a terminal | Shell execution is available | Otherwise provide the exact local command and let the human run it. Never ask for an OAuth token or API token in chat. |
| Existing dashboard session | Browser profile is already signed in | Without it, the human completes sign-in/SSO/2FA/passkeys before continuing. |

Do not declare authentication impossible merely because browser automation is unavailable; degrade to the manual local flow with precise steps.

## Step 3 — Execute exactly one path

- **API token** → load `cloudflare-api-token` for scopes and creation. Store the resulting secret according to the active host:
  - **Native Pi:** reference `CLOUDFLARE_API_TOKEN` from `pi-cloudflare.apiToken`; never put the literal in settings.
  - **Agent Plugin:** Agent Plugins 1.0 has no portable secret-reference field. Use the client's secret/environment configuration so the MCP subprocess receives `CLOUDFLARE_API_TOKEN`.
- **Browser OAuth** → call `cf_<server>_reauthenticate` and run the **exact command returned by that tool**. Native Pi points at its Pi token store; Agent Plugin hosts point at their client-managed `${PLUGIN_DATA}` token file. Do not compose or substitute a token path yourself. The human approves in the browser, then re-verify with a cheap read.
- **Existing API token** → enter it locally using the same host-specific secret mechanism above. Never paste it into chat or write it to repository files, logs, issues, or docs.

On a lost API-token secret later, load `cloudflare-token-roll`. On scope changes, load `cloudflare-token-scopes`.

## Step 4 — Prove it before the real task

Run one cheap read in the task's domain (identity or one list call). Only then continue. If it fails, restart triage instead of retry-looping.

## Rules

- One auth question per session unless the state changes.
- Secrets never belong in chat, repository files, issues, logs, or documentation.
- Native Pi settings hold environment references (`${...}`), never secret literals.
- Agent Plugin hosts use client-managed secret/environment configuration for static API tokens and `${PLUGIN_DATA}` only for the package-managed OAuth token store.
- A 403 naming a missing permission group after setup is a scoping task (`cloudflare-token-scopes`), not a reason to retry auth indefinitely.
