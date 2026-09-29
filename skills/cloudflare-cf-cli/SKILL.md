---
name: cloudflare-cf-cli
description: Use the Cloudflare cf CLI for estate-wide Cloudflare operations from bash — typed commands over the full API (~3,000 operations), JSON output by default, natural-language command discovery, and Workers deploys. Load when a task mentions the cf CLI, when running Cloudflare operations in a shell (deploys, DNS, KV/R2/D1, zones, WAF, cache, secrets), when wrangler lacks a command, or when an agent needs machine-readable Cloudflare output.
---

# Cloudflare cf CLI

`cf` is Cloudflare's agent-first CLI: the full API as typed commands, JSON
output by default, and intent-based command discovery. It is the default
interface for Cloudflare work in a shell. The pi-cloudflare MCP servers stay
available in-session (docs and bindings on by default; api, builds, and
observability are opt-in because cf covers them), and wrangler survives only
as the per-project dev-server implementation cf delegates to.

## Install and auth

```bash
bun add -g cf            # or: npm i -g cf   (open beta, node >= 22)
ln -sf ~/.bun/install/global/node_modules/.bin/cf ~/.bun/bin/cf   # bun quirk: link the bin
```

Auth is read from the environment — **no OAuth login is needed** when the
estate's API token is present, and the CLI inherits whatever scope that token
has:

```bash
export CLOUDFLARE_API_TOKEN=...        # same token the MCP servers use
cf auth whoami                         # authSource: "CLOUDFLARE_API_TOKEN environment variable"
```

If the binary is missing from PATH after a bun global install, the package's
real bin lives at `~/.bun/install/global/node_modules/.bin/cf` — symlink it.

## The two commands that matter most for agents

```bash
cf cli search "purge cache for a zone"   # intent -> command, JSON array out
cf <command>                             # JSON output by default
```

`cf cli search` finds commands by what they do, not by name. Prefer it over
guessing command names, then read the found command's `--help`.

Global flags worth knowing: `-q` (quiet), `-z <zone>` (zone id or domain,
overrides `CLOUDFLARE_ZONE_ID`), `--profile` (auth profile), `--local`
(simulations).

## Where cf wins, and where it does not

| Task | Tool |
| --- | --- |
| API-surface operations in bash (DNS, KV/R2/D1, zones, WAF, cache, secrets) | `cf` — typed commands, JSON out |
| Finding the right API operation | `cf cli search` |
| Workers deploys for migrated projects | `cf deploy` |
| **Local dev** (`cf dev`, `cf build`) | **delegates to the project's dev server** — see below |
| `wrangler tail` | `wrangler` (cf has no tail command) |
| Docs lookup, primitives guidance | `cf_docs_*` / `cf_bindings_*` MCP tools |

## Delegation: why wrangler is still a dependency

`cf deploy`, `cf dev`, and `cf build` do not bundle a bundler or dev server.
They drive whichever **dev-server implementation the project declares**:

- `@cloudflare/vite-plugin` — recommended for new JS/TS projects
- `wrangler` — legacy Worker projects
- `cloudflare-py-dev-server` / `cloudflare-rs-dev-server` — Python / Rust

So for existing Workers, wrangler stays a **project dev dependency** and cf
spawns it (via the `cf-wrangler` delegate binary). Two consequences:

1. **Uninstalling wrangler breaks `cf dev`/`cf build`/`cf deploy`** for any
   project that declares it. Keep it until every project is migrated.
2. The delegation path expects the **new `cloudflare.config.ts`** format. A
   project still on `wrangler.jsonc` fails with
   `cloudflare.config.ts is required when --experimental-new-config is enabled`.
   Run `cf migrate` in the project to convert, or keep using `wrangler deploy`
   there until migrated.

Two more traps from real migrations:

- **cf picks the delegation runner from the package manager it detects**, and
  defaults to `npx`. In a Bun workspace whose `devEngines` rejects npm, every cf
  build fails with `EBADDEVENGINES Invalid devEngines.packageManager` before
  anything runs. Declare `packageManager: "bun@<version>"` in the root manifest
  so cf delegates via `bunx`.
- **Keep both configs in sync during the transition.** The cf flow reads
  `cloudflare.config.ts` + `wrangler.config.ts`; the legacy CI deploy (the
  code-foundry reusable workflow's `wrangler versions upload` / `deploy`)
  reads `wrangler.jsonc`. Deleting `wrangler.jsonc` after `cf migrate` breaks
  the CI deploy even though local cf commands work — and `cf build` will error
  with `no root config found at .cloudflare/output/v0/config.json` because the
  wrangler bundling step runs via the project's own build, not cf build.
- **Never launch wrangler under the Bun runtime.** The code-foundry deploy
  workflow launched it via `bunx --bun`, and one Worker's production deploy
  failed deterministically with `The object can not be cloned` — while other
  Workers deployed fine in the same run — plus wrangler's own warning that it
  does not support the Bun runtime. If a repo's deploy uses a Bun launcher,
  that is the first thing to check when a deploy fails without a clear error.

A project with **no** manifest (`package.json`/`pyproject.toml`/`Cargo.toml`)
cannot be deployed by cf at all — wrangler still deploys a bare `index.js` +
`wrangler.jsonc`.

## Migration

`cf migrate` converts a Wrangler project in place. Vite-based Workers become
`cloudflare.config.ts` automatically. Do it per project, in that project's
repo — not estate-wide from outside.

## Relationship to the pi-cloudflare MCP servers

The MCP servers are in-session tool calls with structured I/O and result caps;
cf is a subprocess with JSON output. The API, builds, and observability
servers are **opt-in** in pi-cloudflare (their surface is cf's ~3,000 typed
commands, `cf builds`, and `cf observability`); docs and bindings remain
enabled by default because cf has no docs search or primitives guidance.
Enable the opt-in servers with `"servers": { "api": true }` in Pi settings
when a task wants in-session structured calls.
