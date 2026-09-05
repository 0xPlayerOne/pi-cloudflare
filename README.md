# pi-cloudflare

One install for Cloudflare-driven agent work: **skills + MCP tools + setup
helper** in a single pi package.

- **Skills** (12 vendored from the official
  [cloudflare/skills](https://github.com/cloudflare/skills) repo: `cloudflare`,
  `wrangler`, `workers-best-practices`, `durable-objects`, `agents-sdk`,
  `cloudflare-email-service`, `cloudflare-one`, `cloudflare-one-migrations`,
  `sandbox-stable`, `sandbox-next`, `sandbox-migrate-to-next`,
  `turnstile-spin`). Refresh with `scripts/sync-skills.sh`
  (kept as a script, not vendored twice).
- **MCP tools** — all five official Cloudflare MCP servers, proxied with
  per-server prefixes (a server that is down or unauthorized is skipped with
  a warning instead of failing the session):

  | Tools           | Server                                          |
  | --------------- | ----------------------------------------------- |
  | `cf_api_*`      | Cloudflare API (2,500+ endpoints)               |
  | `cf_docs_*`     | Developer documentation (works without a token) |
  | `cf_bindings_*` | Workers primitives guidance                     |
  | `cf_builds_*`   | Workers Builds insights                         |
  | `cf_obs_*`      | Workers logs/metrics/traces                     |

## Install

```bash
pi install npm:pi-cloudflare   # once published
pi install /path/to/pi-cloudflare  # from source
```

Tools and skills register on the **next** session start. `web-perf` is
intentionally not vendored: keep your local customized copy (upstream would
clobber environment-specific rules).

Tools and skills register on the **next** session start.

## Authenticate (one-time browser OAuth)

```bash
pi-cloudflare-setup                    # authorize missing servers
pi-cloudflare-setup --only builds    # re-auth specific servers
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

## Development

```bash
npm install
npm test    # typecheck + unit tests (mocked, no network)
```
