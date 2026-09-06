import { homedir } from 'node:os'
import { join } from 'node:path'
import { readFileSync } from 'node:fs'
import { Type } from 'typebox'

import { connectServer, type ServerConnection } from './client.js'
import { refreshAccessToken } from './oauth.js'
import { resolveConfig, type PiCloudflareConfig } from './config.js'
import { buildAllRegistrations, type ToolRegistration } from './proxy.js'
import { CLOUDFLARE_SERVERS, type CloudflareServerDefinition } from './servers.js'
import { isExpired, readTokenFile, writeTokenFile, type StoredServerTokens } from './token-store.js'

interface PiToolDefinition {
  name: string
  label?: string
  description?: string
  parameters?: unknown
  execute: (
    toolCallId: string,
    params: Record<string, unknown>,
    signal?: AbortSignal
  ) => Promise<unknown>
}

interface PiHost {
  registerTool: (definition: PiToolDefinition) => void
  on: (event: 'session_start' | 'session_shutdown', handler: (...args: never[]) => unknown) => void
}

interface PiSettingsFile {
  'pi-cloudflare'?: PiCloudflareConfig
}

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

async function reconnect(entry: ServerEntry): Promise<void> {
  await entry.connection?.close().catch(() => undefined)
  const token = entry.staticToken ?? entry.stored?.accessToken
  entry.connection = await connectServer(entry.definition, {
    apiToken: token,
    timeoutMs: entry.timeoutMs,
  })
  entry.connectedToken = token
}

function expandEnvVars(value: unknown): unknown {
  if (typeof value === 'string') {
    return value.replace(/\$\{([^}]+)\}/g, (_match, expr: string) => {
      const [name, ...rest] = expr.split(':-')
      return process.env[name] ?? rest.join(':-')
    })
  }
  if (Array.isArray(value)) return value.map(expandEnvVars)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, expandEnvVars(entry)])
    )
  }
  return value
}

function loadUserConfig(): PiCloudflareConfig | undefined {
  try {
    const raw = readFileSync(join(homedir(), '.pi', 'agent', 'settings.json'), 'utf8')
    const parsed = JSON.parse(raw) as PiSettingsFile
    const section = parsed['pi-cloudflare']
    if (!section || typeof section !== 'object') return undefined
    return expandEnvVars(section) as PiCloudflareConfig
  } catch {
    return undefined
  }
}

function warn(message: string): void {
  console.warn(`[pi-cloudflare] ${message}`)
}

/** Exact command that re-authorizes one server; shown to agents, never guessed. */
export function reauthHint(serverId: string): string {
  return (
    `${serverId} needs re-authentication (token expired, revoked, or never granted). ` +
    `For temporary access, run in a terminal (approve in the browser when it opens): ` +
    `npx -p pi-cloudflare pi-cloudflare-setup --only ${serverId}. ` +
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

/**
 * Adopt rotations performed by sibling sessions: parallel Pi processes
 * share one token file, and refresh grants are single-use. If the file
 * holds a different grant than memory, the file wins without network I/O.
 */
export function syncFromFile(entry: ServerEntry, home?: string): void {
  const latest = readTokenFile(home)?.servers[entry.definition.id]
  if (latest && latest.refreshToken !== entry.stored?.refreshToken) {
    entry.stored = latest
  }
}

/** Refresh unconditionally (caller decided the token is rejected). Persists and reconnects. */
async function refreshNow(entry: ServerEntry): Promise<void> {
  syncFromFile(entry)
  const stored = entry.stored
  if (!stored?.refreshToken) throw new Error(`${entry.definition.id}: no refresh token stored`)
  const fresh = await refreshAccessToken({
    tokenEndpoint: stored.tokenEndpoint,
    clientId: stored.clientId,
    refreshToken: stored.refreshToken,
  })
  entry.stored = { ...stored, ...fresh }
  const file = readTokenFile() ?? { version: 1 as const, servers: {} }
  file.servers[entry.definition.id] = entry.stored
  writeTokenFile(file.servers)
  await reconnect(entry)
}

/** Refresh an OAuth token that is expired (or nearly so), persisting the result. Static tokens skip refresh. */
async function ensureFreshToken(entry: ServerEntry): Promise<string | undefined> {
  if (entry.staticToken) return entry.staticToken
  syncFromFile(entry)
  const stored = entry.stored
  if (!stored) return undefined
  if (!isExpired(stored) || !stored.refreshToken) {
    if (!entry.connection || entry.connectedToken !== stored.accessToken) {
      await reconnect(entry)
    }
    return stored.accessToken
  }
  await refreshNow(entry)
  return entry.stored?.accessToken
}

/**
 * pi-coding-agent extension entry point.
 *
 * Credentials come only from per-server browser OAuth (pi-cloudflare-setup
 * --oauth), stored owner-only in ~/.pi/cloudflare-tokens.json. The docs
 * server needs no credential. On session_start every enabled server is
 * connected independently and its tools registered with a `cf_<server>_`
 * prefix; unreachable servers are skipped with a re-auth hint instead of
 * failing the session. On session_shutdown all connections close.
 */
export default function piCloudflareExtension(pi: PiHost): void {
  let entries: ServerEntry[] = []

  pi.on('session_start', async () => {
    for (const entry of entries) {
      await entry.connection?.close().catch(() => undefined)
    }
    entries = []
    const userConfig = loadUserConfig() ?? {}
    const config = resolveConfig(userConfig)
    const file = readTokenFile()
    const definitions = CLOUDFLARE_SERVERS.filter((server) =>
      config.enabledServerIds.includes(server.id)
    )
    for (const definition of definitions) {
      const entry: ServerEntry = {
        definition,
        timeoutMs: config.connectTimeoutMs,
        staticToken: definition.id === 'api' ? userConfig.apiToken : undefined,
      }
      try {
        entry.stored = file?.servers[definition.id]
        await ensureFreshToken(entry)
        if (!entry.connection) await reconnect(entry)
        const tools = (await entry.connection?.listTools()) ?? []
        const registrations: ToolRegistration[] = buildAllRegistrations([
          {
            prefix: definition.prefix,
            tools,
            callTool: async (name, params) => {
              if (!entry.connection) throw new Error(`${definition.id}: not connected`)
              return entry.connection.callTool(name, params)
            },
          },
        ])
        for (const registration of registrations) {
          pi.registerTool({
            ...registration,
            execute: async (toolCallId, params, signal) => {
              await ensureFreshToken(entry)
              try {
                return await registration.execute(toolCallId, params, signal)
              } catch (error) {
                // Clock-fresh but server-rejected: one forced refresh plus
                // reconnect and retry before giving the agent a dead end.
                if (!isAuthFailure(error) || entry.staticToken || !entry.stored?.refreshToken) {
                  throw error
                }
                try {
                  await refreshNow(entry)
                  return await registration.execute(toolCallId, params, signal)
                } catch {
                  const detail = error instanceof Error ? error.message : String(error)
                  throw new Error(
                    `${definition.id}: request rejected (${detail}). ${reauthHint(definition.id)}`
                  )
                }
              }
            },
          })
        }
        entries.push(entry)
      } catch (error) {
        warn(
          `${definition.id}: unavailable (${error instanceof Error ? error.message : String(error)}).`
        )
        if (isAuthFailure(error)) {
          // Agents rarely see process logs: register a stub they will find.
          pi.registerTool({
            name: `${definition.prefix}reauthenticate`,
            label: `${definition.prefix}reauthenticate`,
            description: `${definition.id} is not authenticated. Call this tool for exact re-authentication instructions.`,
            parameters: Type.Object({}),
            execute: async () => ({
              content: [{ type: 'text', text: reauthHint(definition.id) }],
            }),
          })
          warn(reauthHint(definition.id))
        }
        await entry.connection?.close().catch(() => undefined)
      }
    }
  })

  pi.on('session_shutdown', async () => {
    await Promise.all(entries.map((entry) => entry.connection?.close().catch(() => undefined)))
    entries = []
  })
}
