# pi-cloudflare

One install for Cloudflare-driven agent work: **skills + MCP tools + setup
helper** in a single pi package.

- **Skills** (12 vendored from the official
  [cloudflare/skills](https://github.com/cloudflare/skills) repo: `cloudflare`,
  `wrangler`, `workers-best-practices`, `durable-objects`, `agents-sdk`,
  `cloudflare-email-service`, `cloudflare-one`, `cloudflare-one-migrations`,
  `sandbox-stable`, `sandbox-next`, `sandbox-migrate-to-next`,
  `turnstile-spin`). Refresh with `scripts/sync-skills.sh`.
- **MCP tools** — all five official Cloudflare MCP servers, proxied with
  per-server prefixes (a server that is down or unauthorized is skipped with
  a warning instead of failing the session):

  | Tools           | Server                                   |
  | --------------- | ---------------------------------------- |
  | `cf_api_*`      | Cloudflare API (2,500+ endpoints)        |
  | `cf_docs_*`     | Developer documentation (no auth needed) |
  | `cf_bindings_*` | Workers primitives guidance              |
  | `cf_builds_*`   | Workers Builds insights                  |
  | `cf_obs_*`      | Workers logs/metrics/traces              |

Requires pi with package support, Node 20.19+ (or 22.12+), and network
access. No browser, wrangler CLI, or API token needed to install; the docs
tools work immediately after install.

![Architecture](https://raw.githubusercontent.com/0xPlayerOne/pi-cloudflare/main/docs/assets/architecture.svg)

## Install

```bash
pi install npm:pi-cloudflare
```

Tools and skills register on the **next** session start. (`web-perf` is
intentionally not vendored: keep a local customized copy instead, since the
upstream version would clobber environment-specific rules.)

## Authenticate (one-time browser OAuth)

```bash
npx -p pi-cloudflare pi-cloudflare-setup                    # authorize missing servers
npx -p pi-cloudflare pi-cloudflare-setup --only builds    # re-auth specific servers
```

Each Cloudflare MCP server is its own OAuth issuer, so approval happens
once per server (docs needs none): the command opens one tab per server,
you approve, and tokens (with refresh) are stored owner-only in
`~/.pi/cloudflare-tokens.json`. The extension refreshes them silently
before expiry, and setup skips servers that are still fresh. If a server
later rejects its token, rerun setup (with `--only` for just that one).
Nothing is ever logged or committed.

## Configure (optional)

In `~/.pi/agent/settings.json`:

```jsonc
{
  "pi-cloudflare": {
    "servers": { "builds": false }, // disable individual servers
    "connectTimeoutMs": 30000,
  },
}
```

## Troubleshooting

| Symptom                                      | Likely cause                            | Fix                                                                                                                  |
| -------------------------------------------- | --------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `Browser connection failed` on session start | A server is down or its token expired   | The extension skips it with a warning and continues; rerun `pi-cloudflare-setup --only <server>` for the failing one |
| OAuth tab never opens                        | Headless environment or blocked popup   | Copy the printed URL into any browser; tokens land in `~/.pi/cloudflare-tokens.json` either way                      |
| `401` from one server only                   | That server's refresh token was revoked | `npx -p pi-cloudflare pi-cloudflare-setup --only <server>`                                                           |
| Tools missing for a server                   | Disabled via `servers: { <id>: false }` | Re-enable in settings; tools register on next session start                                                          |
| Rate-limited API calls                       | Too many write calls in a loop          | Back off and batch; prefer one `cf_api_execute` with a precise query over paginated scans                            |

## Development

```bash
npm install
npm test    # typecheck + unit tests (mocked, no network)
```

## License

MIT for this package's own code (see LICENSE). Vendored skill content
under `skills/` remains under its upstream Apache License, Version 2.0
(see NOTICE).
