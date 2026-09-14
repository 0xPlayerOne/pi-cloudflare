import type { CloudflareServerId } from './servers.js'
import { CLOUDFLARE_SERVERS } from './servers.js'

export interface PiCloudflareConfig {
  /** Per-server enablement. Omitted servers default to enabled. */
  servers?: Partial<Record<CloudflareServerId, boolean>>
  /** Connection timeout per server in milliseconds. */
  connectTimeoutMs?: number
  /**
   * Static bearer token applied to every enabled server (e.g. a Cloudflare
   * API token from ${CLOUDFLARE_API_TOKEN}). Never expires, never needs
   * browser OAuth — when set, stored OAuth tokens are never consulted — and
   * takes precedence over stored OAuth tokens.
   */
  apiToken?: string
}

export interface ResolvedPiCloudflareConfig {
  enabledServerIds: CloudflareServerId[]
  connectTimeoutMs: number
}

const DEFAULT_CONNECT_TIMEOUT_MS = 30_000

export function resolveConfig(config: PiCloudflareConfig | undefined): ResolvedPiCloudflareConfig {
  const enabledServerIds = CLOUDFLARE_SERVERS.map((server) => server.id).filter(
    (id) => config?.servers?.[id] !== false
  )
  return {
    enabledServerIds,
    connectTimeoutMs: config?.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS,
  }
}
