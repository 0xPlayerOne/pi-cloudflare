import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import type { CloudflareServerId } from './servers.js'

/** The slice of an upstream tool the proxy registers from. */
export interface CachedTool {
  name: string
  description?: string | undefined
  inputSchema: Record<string, unknown>
}

export interface ToolCacheEntry {
  capturedAt: number
  tools: CachedTool[]
}

export interface ToolCache {
  version: 1
  servers: Partial<Record<CloudflareServerId, ToolCacheEntry>>
}

/** Cache lives beside the token file so portable hosts keep theirs in plugin data. */
export function toolsCachePathNear(tokenFile: string): string {
  return join(dirname(tokenFile), 'cloudflare-tools-cache.json')
}

/** Read cached per-server tool lists. A missing or malformed file means no cache. */
export function readToolCacheAt(path: string): ToolCache | undefined {
  if (!existsSync(path)) return undefined
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as ToolCache
    if (parsed?.version !== 1 || typeof parsed.servers !== 'object' || parsed.servers === null) {
      return undefined
    }
    for (const entry of Object.values(parsed.servers)) {
      if (
        !entry ||
        !Array.isArray(entry.tools) ||
        entry.tools.some((tool) => !tool || typeof tool.name !== 'string')
      ) {
        return undefined
      }
    }
    return parsed
  } catch {
    return undefined
  }
}

/**
 * Persist one server's tool list with an atomic replace so concurrent agent
 * sessions cannot leave a partial file.
 */
export function updateToolCacheAt(id: CloudflareServerId, tools: CachedTool[], path: string): void {
  if (tools.length === 0) return
  const cache = readToolCacheAt(path) ?? { version: 1 as const, servers: {} }
  cache.servers[id] = { capturedAt: Date.now(), tools }
  mkdirSync(dirname(path), { recursive: true })
  const tmp = `${path}.${process.pid}.tmp`
  writeFileSync(tmp, JSON.stringify(cache, null, 2) + '\n')
  renameSync(tmp, path)
}
