# pi-cloudflare

One package for Cloudflare-driven agent work: **skills only**. The tools live
in [Cloudflare's `cf` CLI](https://developers.cloudflare.com/fundamentals/tools-and-sdks/cf-cli/)
— this package ships the knowledge that directs agents to use it well.

- **13 skills vendored from the official
  [cloudflare/skills](https://github.com/cloudflare/skills) library**:
  `agents-sdk`, `cloudflare`, `cloudflare-email-service`, `cloudflare-one`,
  `cloudflare-one-migrations`, `durable-objects`, `nextjs-on-cloudflare`,
  `sandbox-migrate-to-next`, `sandbox-next`, `sandbox-stable`,
  `turnstile-spin`, `workers-best-practices`, `wrangler`. Refresh with
  `scripts/sync-skills.sh`.
- **5 authored, cf-first skills** born from running a 16-zone Free-plan
  estate through the cf CLI:
  - [`cloudflare-cf-cli`](skills/cloudflare-cf-cli/SKILL.md) — install, auth,
    intent search, and the deploy chain (`cf-wrangler build` → `cf deploy
--prebuilt`), with the traps that otherwise cost hours (stale Build
    Output uploads, runner detection, module rules).
  - [`cloudflare-hardening`](skills/cloudflare-hardening/SKILL.md) — the
    Free-plan hardening baseline plus a read-only estate audit script.
  - [`cloudflare-token-scopes`](skills/cloudflare-token-scopes/SKILL.md) —
    change scopes on an existing API token in place.
  - [`cloudflare-token-roll`](skills/cloudflare-token-roll/SKILL.md) — roll a
    leaked token without breaking every consumer at once.
  - [`cloudflare-api-token`](skills/cloudflare-api-token/SKILL.md) — build
    the estate token's 141-group scope from the exact permission-group
    catalog.

(`web-perf` is intentionally not vendored: keep a local customized copy
instead, since the upstream version would clobber environment-specific rules.)

Distributed both as a native Pi package and an
[Agent Plugins 1.0](https://agent-plugins.org/) package. Skills register on
the next session start after install; no network, browser, or token is
needed to install.

## Install

### Pi

```bash
pi install npm:pi-cloudflare
```

### Agent Plugins 1.0

The published npm package is also a self-contained Agent Plugin. Its root
`plugin.json` discovers `skills/`. Agent Plugins deliberately leaves
installation sources to each client — unpack the npm package using the
client-specific plugin flow, with the package root as `PLUGIN_ROOT`. A raw
Git checkout works directly (there is nothing to build).

## Tools: the cf CLI

All Cloudflare operations go through the `cf` CLI — the full API as typed
commands (~3,000 operations), JSON output by default, and intent-based
command discovery:

```bash
bun add -g cf            # or: npm i -g cf   (open beta, node >= 22)
cf cli search "purge cache for a zone"   # intent -> command
cf zones list                            # JSON out
```

Authenticate from the environment — no OAuth login exists or is needed:

```bash
export CLOUDFLARE_API_TOKEN=...   # scope guidance in docs/api-token.md
cf auth whoami
```

| Task                                 | Use                                                 |
| ------------------------------------ | --------------------------------------------------- |
| Full API as typed commands, JSON out | `cf` CLI (`cf zones list`, `cf d1 ...`)             |
| Finding the right API operation      | `cf cli search "<intent>"`                          |
| Workers deploys and previews         | `cf deploy --prebuilt`, `cf previews deploy`        |
| KV/R2/D1 CLIs, scripting             | `cf`                                                |
| Workers primitives guidance          | `workers-best-practices` / `durable-objects` skills |
| Cloudflare product docs              | developers.cloudflare.com                           |

`wrangler` remains a per-project devDependency **only** as the dev-server
implementation that `cf dev`/`cf build`/`cf deploy` delegate to, and for
`wrangler dev`/`wrangler types` during local development. Never invoke it as
the deploy interface. See `skills/cloudflare-cf-cli/SKILL.md`.

## Migrating from 0.10.x and earlier

Earlier releases proxied the five official Cloudflare MCP servers
(`cf_api_*`, `cf_docs_*`, `cf_bindings_*`, `cf_builds_*`, `cf_obs_*`). Those
are **removed**: the cf CLI covers the API, builds, and observability
surfaces with better ergonomics for agents, and docs/primitives knowledge
moved to the vendored skills. Re-run `pi install npm:pi-cloudflare` (or
update the plugin) and start the next session; optionally revoke the old
browser OAuth grants for the Cloudflare MCP issuers, which are no longer
used. Stored OAuth tokens under `~/.pi/cloudflare-tokens.json` are no longer
read and can be deleted.

## Development

```bash
npm install
npm test             # validates the skills library (frontmatter, naming)
npm run format:check # oxfmt
bash scripts/sync-skills.sh   # refresh vendored skills from cloudflare/skills
```
