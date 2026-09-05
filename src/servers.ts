/**
 * The Cloudflare MCP servers this extension can proxy. All are remote
 * Streamable HTTP endpoints; authentication (when required) is a Bearer
 * token from the environment, never from config files.
 */
export type CloudflareServerId = 'api' | 'docs' | 'bindings' | 'builds' | 'observability'

export interface CloudflareServerDefinition {
  id: CloudflareServerId
  /** Tool prefix, e.g. `cf_api_` for the API server. */
  prefix: `cf_${string}_`
  /** Streamable HTTP endpoint. */
  url: string
  /** Whether this server is expected to work without a token. */
  public?: boolean
  description: string
}

export const CLOUDFLARE_SERVERS: readonly CloudflareServerDefinition[] = [
  {
    id: 'api',
    prefix: 'cf_api_',
    url: 'https://mcp.cloudflare.com/mcp',
    description:
      'Full Cloudflare API (2,500+ endpoints: Workers, R2, DNS, Zero Trust) via search and execute tools.',
  },
  {
    id: 'docs',
    prefix: 'cf_docs_',
    url: 'https://docs.mcp.cloudflare.com/mcp',
    public: true,
    description: 'Up-to-date Cloudflare developer documentation search and fetch.',
  },
  {
    id: 'bindings',
    prefix: 'cf_bindings_',
    url: 'https://bindings.mcp.cloudflare.com/mcp',
    description: 'Workers primitives guidance (KV, R2, D1, Durable Objects, AI).',
  },
  {
    id: 'builds',
    prefix: 'cf_builds_',
    url: 'https://builds.mcp.cloudflare.com/mcp',
    description: 'Workers Builds insights and management.',
  },
  {
    id: 'observability',
    prefix: 'cf_obs_',
    url: 'https://observability.mcp.cloudflare.com/mcp',
    description: 'Workers logs, metrics, and traces analysis.',
  },
]

export function serverById(id: CloudflareServerId): CloudflareServerDefinition {
  const found = CLOUDFLARE_SERVERS.find((server) => server.id === id)
  if (!found) throw new Error(`Unknown Cloudflare MCP server: ${id}`)
  return found
}
