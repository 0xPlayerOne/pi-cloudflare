import { Type } from 'typebox'

import { connectServer, type ServerConnection } from './client.js'
import { resolveConfig, type PiCloudflareConfig } from './config.js'
import { refreshAccessToken } from './oauth.js'
import { buildAllRegistrations, type ToolRegistration } from './proxy.js'
import {
  CLOUDFLARE_SERVERS,
  type CloudflareServerDefinition,
  type CloudflareServerId,
} from './servers.js'
import {
  readToolCacheAt,
  toolsCachePathNear,
  updateToolCacheAt,
  type CachedTool,
} from './tool-cache.js'
import {
  isExpired,
  readTokenFileAt,
  tokenFilePath,
  writeTokenFileAt,
  type StoredServerTokens,
} from './token-store.js'

interface ServerEntry {
  definition: CloudflareServerDefinition
  connection?: ServerConnection
  stored?: StoredServerTokens
  /** Static bearer token (API token): never expires, never refreshes, no OAuth. */
  staticToken?: string
  timeoutMs: number
  /** Access token the live connection was built with; drift triggers reconnect. */
  connectedToken?: string
}

export interface CloudflareRuntimeOptions {
  /** Shared runtime configuration. Native Pi supplies settings; portable hosts normally use defaults. */
  config?: PiCloudflareConfig
  /** OAuth token file. Defaults to Pi's legacy ~/.pi/cloudflare-tokens.json for compatibility. */
  tokenFile?: string
  /** Cached upstream tool lists. Defaults to cloudflare-tools-cache.json beside the token file. */
  toolsCache?: string
  /** Optional local setup script used in portable re-authentication hints. */
  setupScript?: string
  /** Warning sink. Native Pi uses console.warn; the stdio server uses stderr. */
  warn?: (message: string) => void
  /** Connection factory; overridable in tests. */
  connect?: typeof connectServer
}

function quoteArg(value: string): string {
  return JSON.stringify(value)
}

/** Exact command that re-authorizes one server; shown to agents, never guessed. */
export function reauthHint(
  serverId: string,
  options: { tokenFile?: string; setupScript?: string } = {}
): string {
  const setupCommand =
    options.tokenFile && options.setupScript
      ? `node ${quoteArg(options.setupScript)} --token-file ${quoteArg(options.tokenFile)} --only ${serverId}`
      : `npx -p pi-cloudflare pi-cloudflare-setup --only ${serverId}`
  return (
    `${serverId} needs re-authentication (token expired, revoked, or never granted). ` +
    `For temporary access, run in a terminal (approve in the browser when it opens): ` +
    `${setupCommand}. ` +
    `For persistent access across sessions, create an API token instead — ` +
    `see the cloudflare-auth-setup skill (it asks once, then sets up either path).`
  )
}

/** True when a failure smells like rejected credentials rather than a broken server. */
export function isAuthFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  const code =
    error && typeof error === 'object' && 'code' in error
      ? (error as { code?: unknown }).code
      : undefined
  // StreamableHTTPError keeps the HTTP status in `code`; auth responses may have no body.
  return (
    code === 401 ||
    code === 403 ||
    code === '401' ||
    code === '403' ||
    /\b401\b|\b403\b|unauthorized|invalid_token|invalid_grant|token refresh failed|expired|forbidden|authenticate/i.test(
      message
    )
  )
}

function syncFromTokenFile(
  entry: { definition: { id: CloudflareServerId }; stored?: StoredServerTokens },
  path: string
): void {
  const latest = readTokenFileAt(path)?.servers[entry.definition.id]
  if (latest && latest.refreshToken !== entry.stored?.refreshToken) {
    entry.stored = latest
  }
}

/**
 * Adopt rotations performed by sibling native Pi sessions. Kept as a public
 * compatibility helper; portable runtimes use their explicit plugin-data path.
 */
export function syncFromFile(
  entry: { definition: { id: CloudflareServerId }; stored?: StoredServerTokens },
  home?: string
): void {
  syncFromTokenFile(entry, tokenFilePath(home))
}

function cacheableTools(tools: CachedTool[]): CachedTool[] {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
  }))
}

export class CloudflareRuntime {
  private entries: ServerEntry[] = []
  private readonly config: PiCloudflareConfig
  private readonly tokenFile: string
  private readonly toolsCache: string
  private readonly setupScript: string | undefined
  private readonly warn: (message: string) => void
  private readonly connect: typeof connectServer

  constructor(options: CloudflareRuntimeOptions = {}) {
    this.config = options.config ?? {}
    this.tokenFile = options.tokenFile ?? tokenFilePath()
    this.toolsCache = options.toolsCache ?? toolsCachePathNear(this.tokenFile)
    this.setupScript = options.setupScript
    this.warn = options.warn ?? (() => undefined)
    this.connect = options.connect ?? connectServer
  }

  private hint(serverId: string): string {
    return reauthHint(serverId, {
      tokenFile: this.setupScript ? this.tokenFile : undefined,
      setupScript: this.setupScript,
    })
  }

  private async reconnect(entry: ServerEntry): Promise<void> {
    await entry.connection?.close().catch(() => undefined)
    const token = entry.staticToken ?? entry.stored?.accessToken
    entry.connection = await this.connect(entry.definition, {
      apiToken: token,
      timeoutMs: entry.timeoutMs,
    })
    entry.connectedToken = token
  }

  /** Refresh unconditionally after a credential rejection, persist, and reconnect. */
  private async refreshNow(entry: ServerEntry): Promise<void> {
    syncFromTokenFile(entry, this.tokenFile)
    const stored = entry.stored
    if (!stored?.refreshToken) throw new Error(`${entry.definition.id}: no refresh token stored`)
    const fresh = await refreshAccessToken({
      tokenEndpoint: stored.tokenEndpoint,
      clientId: stored.clientId,
      refreshToken: stored.refreshToken,
    })
    entry.stored = { ...stored, ...fresh }
    const file = readTokenFileAt(this.tokenFile) ?? { version: 1 as const, servers: {} }
    file.servers[entry.definition.id] = entry.stored
    writeTokenFileAt(file.servers, this.tokenFile)
    await this.reconnect(entry)
  }

  /** Resolve the bearer for a call: static API token, else OAuth refreshed when expired. */
  private async ensureFreshToken(entry: ServerEntry): Promise<string | undefined> {
    if (entry.staticToken) return entry.staticToken
    syncFromTokenFile(entry, this.tokenFile)
    const stored = entry.stored
    if (!stored) return undefined
    if (!isExpired(stored) || !stored.refreshToken) return stored.accessToken
    await this.refreshNow(entry)
    return entry.stored?.accessToken
  }

  /**
   * Open the connection lazily on first use; a live connection whose token
   * drifted (rotated by a sibling session) reconnects. After connecting,
   * refresh the tool cache in the background so the next session starts
   * without touching the network.
   */
  private async ensureConnection(entry: ServerEntry, warmCache = true): Promise<void> {
    const token = await this.ensureFreshToken(entry)
    if (!entry.connection || entry.connectedToken !== token) {
      await this.reconnect(entry)
      if (warmCache) this.refreshCachedTools(entry)
    }
  }

  /** Best-effort cache refresh; never blocks or fails the tool call that triggered it. */
  private refreshCachedTools(entry: ServerEntry): void {
    void entry.connection
      ?.listTools()
      .then((tools) =>
        updateToolCacheAt(entry.definition.id, cacheableTools(tools), this.toolsCache)
      )
      .catch(() => undefined)
  }

  /** Wrap registrations so the connection (and its auth) opens on first call. */
  private registrationsFor(entry: ServerEntry, tools: CachedTool[]): ToolRegistration[] {
    const registrations = buildAllRegistrations([
      {
        prefix: entry.definition.prefix,
        tools,
        callTool: async (name, params) => {
          if (!entry.connection) throw new Error(`${entry.definition.id}: not connected`)
          return entry.connection.callTool(name, params)
        },
      },
    ])
    for (const registration of registrations) {
      const callUpstream = registration.execute
      registration.execute = async (toolCallId, params, signal) => {
        try {
          await this.ensureConnection(entry)
          return await callUpstream(toolCallId, params, signal)
        } catch (error) {
          const detail = error instanceof Error ? error.message : String(error)
          if (entry.staticToken) {
            if (isAuthFailure(error)) {
              throw new Error(
                `${entry.definition.id}: request rejected (${detail}). ` +
                  `Check the configured API token (CLOUDFLARE_API_TOKEN) and its scopes.`,
                { cause: error }
              )
            }
            throw error
          }
          if (!isAuthFailure(error)) throw error
          if (entry.stored?.refreshToken) {
            try {
              await this.refreshNow(entry)
              return await callUpstream(toolCallId, params, signal)
            } catch {
              /* fall through to the recovery hint */
            }
          }
          throw new Error(
            `${entry.definition.id}: request rejected (${detail}). ${this.hint(entry.definition.id)}`,
            { cause: error }
          )
        }
      }
    }
    return registrations
  }

  /**
   * Register the cf_* tool surface without touching the network: servers with
   * a cached tool list register instantly and connect on their first tool
   * call. Servers without one — first run only — are discovered eagerly so
   * their tools exist from the very first session.
   */
  async start(): Promise<ToolRegistration[]> {
    await this.stop()
    const registrations: ToolRegistration[] = []
    const config = resolveConfig(this.config)
    const file = readTokenFileAt(this.tokenFile)
    const cache = readToolCacheAt(this.toolsCache)
    const definitions = CLOUDFLARE_SERVERS.filter((server) =>
      config.enabledServerIds.includes(server.id)
    )

    for (const definition of definitions) {
      // A configured API token is the bearer for every server; OAuth is never consulted.
      const entry: ServerEntry = {
        definition,
        timeoutMs: config.connectTimeoutMs,
        staticToken: this.config.apiToken,
      }
      const cached = cache?.servers[definition.id]?.tools
      if (cached?.length) {
        registrations.push(...this.registrationsFor(entry, cached))
        this.entries.push(entry)
        continue
      }
      try {
        entry.stored = file?.servers[definition.id]
        await this.ensureConnection(entry, false)
        const tools = (await entry.connection?.listTools()) ?? []
        updateToolCacheAt(definition.id, cacheableTools(tools), this.toolsCache)
        registrations.push(...this.registrationsFor(entry, cacheableTools(tools)))
        this.entries.push(entry)
      } catch (error) {
        this.warn(
          `${definition.id}: unavailable (${error instanceof Error ? error.message : String(error)}).`
        )
        if (isAuthFailure(error)) {
          if (entry.staticToken) {
            this.warn(
              `${definition.id}: check the configured API token (CLOUDFLARE_API_TOKEN) and its scopes.`
            )
          } else {
            const hint = this.hint(definition.id)
            registrations.push({
              name: `${definition.prefix}reauthenticate`,
              label: `${definition.prefix}reauthenticate`,
              description: `${definition.id} is not authenticated. Call this tool for exact re-authentication instructions.`,
              inputSchema: { type: 'object', properties: {}, additionalProperties: false },
              parameters: Type.Object({}),
              execute: async () => ({
                content: [{ type: 'text', text: hint }],
              }),
            })
            this.warn(hint)
          }
        }
        await entry.connection?.close().catch(() => undefined)
      }
    }

    return registrations
  }

  async stop(): Promise<void> {
    await Promise.all(this.entries.map((entry) => entry.connection?.close().catch(() => undefined)))
    this.entries = []
  }
}
