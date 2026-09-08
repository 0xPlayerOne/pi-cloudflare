import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import type { PiCloudflareConfig } from './config.js'
import { CloudflareRuntime } from './runtime.js'

export { isAuthFailure, reauthHint, syncFromFile } from './runtime.js'

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

/**
 * Native pi-coding-agent adapter.
 *
 * The Cloudflare runtime is host-independent; Pi contributes only settings,
 * lifecycle hooks, and tool registration. This preserves the existing
 * `pi install npm:pi-cloudflare` behavior while Agent Plugins clients use the
 * stdio adapter in mcp.json.
 */
export default function piCloudflareExtension(pi: PiHost): void {
  let runtime: CloudflareRuntime | undefined

  pi.on('session_start', async () => {
    await runtime?.stop()
    runtime = new CloudflareRuntime({ config: loadUserConfig() ?? {}, warn })
    const registrations = await runtime.start()
    for (const registration of registrations) {
      pi.registerTool(registration)
    }
  })

  pi.on('session_shutdown', async () => {
    await runtime?.stop()
    runtime = undefined
  })
}
