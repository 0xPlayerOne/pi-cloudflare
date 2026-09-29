---
name: cloudflare-cf-cli
description: Use the Cloudflare cf CLI for estate-wide Cloudflare operations from bash — typed commands over the full API (~3,000 operations), JSON output by default, natural-language command discovery, and Workers deploys. Load when a task mentions the cf CLI, when running Cloudflare operations in a shell (deploys, DNS, KV/R2/D1, zones, WAF, cache, secrets), when wrangler lacks a command, or when an agent needs machine-readable Cloudflare output.
---

# Cloudflare cf CLI

`cf` is Cloudflare's agent-first CLI: the full API as typed commands, JSON
output by default, and intent-based command discovery. It is the default
interface for Cloudflare work in a shell. Wrangler survives only as the
per-project dev-server implementation cf delegates to.

## Install and auth

```bash
bun add -g cf            # or: npm i -g cf   (open beta, node >= 22)
ln -sf ~/.bun/install/global/node_modules/.bin/cf ~/.bun/bin/cf   # bun quirk: link the bin
```

Auth is read from the environment — **no OAuth login is needed** when the
estate's API token is present, and the CLI inherits whatever scope that token
has:

```bash
export CLOUDFLARE_API_TOKEN=...        # the estate's API token
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
| Docs lookup, primitives guidance | developers.cloudflare.com; `workers-best-practices` / `durable-objects` skills |

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

## Deploying without the framework autoconfig trap

Plain `cf deploy` (no flags) runs the **framework-detected build** from
autoconfig, then uploads whatever Build Output exists. In a monorepo project
whose build does not emit the Build Output itself, that combination re-runs
the wrong build and uploads a **stale Build Output** — the deploy succeeds
while shipping the previous build. The reliable chain for every project:

```bash
bun run build        # the project's real build (turbo/npm script)
cf-wrangler build    # refresh .cloudflare/output/v0 from the config pair
cf deploy --prebuilt # upload the existing Build Output without rebuilding
```

Three rules that make the chain work, all live-verified:

- **cf discovers its delegate from the nearest `package.json`.** In a
  workspace, the app package must declare `cf` and `wrangler` in its own
  devDependencies — root-only placement makes cf fall back to autoconfig
  (runner `npx`, wrong build command), which under Bun `devEngines` fails
  with `EBADDEVENGINES`. Declaring `packageManager: "bun@<version>"` in the
  app manifest fixes the runner.
- **wrangler ≥ 4.143 understands cf's `defineConfig` marker.** Older
  wrangler rejects a `cloudflare.config.ts` default export with
  "not a supported export type" — upgrade wrangler, don't restructure the
  config.
- **Multi-module builds need the ESModule rules in `wrangler.config.ts`.**
  Vite-plugin output (additional `start-assets/` modules) and Nitro's chunk
  layout only ship when `rules: [{type: "ESModule", globs: ["**/*.js",
  "**/*.mjs"]}]` is present alongside `noBundle: true`; without them the
  deploy fails validation with `No such module` (10021).

## Relationship to wrangler and the old MCP servers

cf is a subprocess with JSON output; the former pi-cloudflare MCP servers
(`cf_api_*`, `cf_docs_*`, `cf_bindings_*`, `cf_builds_*`, `cf_obs_*`) were
removed — cf's ~3,000 typed commands plus `cf builds` and `cf
observability` cover their surfaces, and docs/primitives knowledge lives in
the vendored Cloudflare skills. Wrangler stays a per-project devDependency
only as cf's dev-server delegate (see above).
