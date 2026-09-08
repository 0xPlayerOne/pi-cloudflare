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
  /** Static bearer token (api server only): never expires, never refreshes. */
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
  /** Optional local setup script used in portable re-authentication hints. */
  setupScript?: string
  /** Warning sink. Native Pi uses console.warn; the stdio server uses stderr. */
  warn?: (message: string) => void
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
  return /\b401\b|\b403\b|unauthorized|invalid_token|invalid_grant|token refresh failed|expired|forbidden|authenticate/i.test(
    message
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

export class CloudflareRuntime {
  private entries: ServerEntry[] = []
  private readonly config: PiCloudflareConfig
  private readonly tokenFile: string
  private readonly setupScript: string | undefined
  private readonly warn: (message: string) => void

  constructor(options: CloudflareRuntimeOptions = {}) {
    this.config = options.config ?? {}
    this.tokenFile = options.tokenFile ?? tokenFilePath()
    this.setupScript = options.setupScript
    this.warn = options.warn ?? (() => undefined)
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
    entry.connection = await connectServer(entry.definition, {
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

  /** Refresh an OAuth token that is expired (or nearly so). Static tokens skip refresh. */
  private async ensureFreshToken(entry: ServerEntry): Promise<string | undefined> {
    if (entry.staticToken) return entry.staticToken
    syncFromTokenFile(entry, this.tokenFile)
    const stored = entry.stored
    if (!stored) return undefined
    if (!isExpired(stored) || !stored.refreshToken) {
      if (!entry.connection || entry.connectedToken !== stored.accessToken) {
        await this.reconnect(entry)
      }
      return stored.accessToken
    }
    await this.refreshNow(entry)
    return entry.stored?.accessToken
  }

  /**
   * Connect enabled Cloudflare servers independently and expose one curated
   * cf_* tool surface. One unavailable server never prevents the others.
   */
  async start(): Promise<ToolRegistration[]> {
    await this.stop()
    const registrations: ToolRegistration[] = []
    const config = resolveConfig(this.config)
    const file = readTokenFileAt(this.tokenFile)
    const definitions = CLOUDFLARE_SERVERS.filter((server) =>
      config.enabledServerIds.includes(server.id)
    )

    for (const definition of definitions) {
      const entry: ServerEntry = {
        definition,
        timeoutMs: config.connectTimeoutMs,
        staticToken: definition.id === 'api' ? this.config.apiToken : undefined,
      }
      try {
        entry.stored = file?.servers[definition.id]
        await this.ensureFreshToken(entry)
        if (!entry.connection) await this.reconnect(entry)
        const tools = (await entry.connection?.listTools()) ?? []
        const serverRegistrations = buildAllRegistrations([
          {
            prefix: definition.prefix,
            tools,
            callTool: async (name, params) => {
              if (!entry.connection) throw new Error(`${definition.id}: not connected`)
              return entry.connection.callTool(name, params)
            },
          },
        ])

        for (const registration of serverRegistrations) {
          registrations.push({
            ...registration,
            execute: async (toolCallId, params, signal) => {
              try {
                await this.ensureFreshToken(entry)
                return await registration.execute(toolCallId, params, signal)
              } catch (error) {
                if (!isAuthFailure(error) || entry.staticToken || !entry.stored?.refreshToken) {
                  throw error
                }
                try {
                  await this.refreshNow(entry)
                  return await registration.execute(toolCallId, params, signal)
                } catch {
                  const detail = error instanceof Error ? error.message : String(error)
                  throw new Error(
                    `${definition.id}: request rejected (${detail}). ${this.hint(definition.id)}`
                  )
                }
              }
            },
          })
        }
        this.entries.push(entry)
      } catch (error) {
        this.warn(
          `${definition.id}: unavailable (${error instanceof Error ? error.message : String(error)}).`
        )
        if (isAuthFailure(error)) {
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
