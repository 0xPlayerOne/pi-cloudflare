import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

import type { OAuthTokens } from './oauth.js'
import type { CloudflareServerId } from './servers.js'

export interface StoredServerTokens extends OAuthTokens {
  clientId: string
  tokenEndpoint: string
}

export interface TokenFile {
  version: 1
  servers: Partial<Record<CloudflareServerId, StoredServerTokens>>
}

export function tokenFilePath(home = homedir()): string {
  return join(home, '.pi', 'cloudflare-tokens.json')
}

/** Read stored per-server OAuth tokens from an explicit file path. */
export function readTokenFileAt(path: string): TokenFile | undefined {
  if (!existsSync(path)) return undefined
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as TokenFile
    if (parsed?.version !== 1 || typeof parsed.servers !== 'object') return undefined
    return parsed
  } catch {
    return undefined
  }
}

/** Read the legacy native-Pi token store. Missing file means not authenticated. */
export function readTokenFile(home = homedir()): TokenFile | undefined {
  return readTokenFileAt(tokenFilePath(home))
}

/**
 * Persist per-server tokens at an explicit path with owner-only permissions.
 * Writes atomically so concurrent agent sessions cannot leave a partial file.
 */
export function writeTokenFileAt(
  servers: Partial<Record<CloudflareServerId, StoredServerTokens>>,
  path: string
): void {
  mkdirSync(dirname(path), { recursive: true })
  const tmp = `${path}.${process.pid}.tmp`
  writeFileSync(tmp, JSON.stringify({ version: 1, servers }, null, 2) + '\n', {
    mode: 0o600,
  })
  chmodSync(tmp, 0o600)
  renameSync(tmp, path)
}

/**
 * Persist per-server tokens with owner-only permissions in native Pi's
 * ~/.pi/cloudflare-tokens.json.
 */
export function writeTokenFile(
  servers: Partial<Record<CloudflareServerId, StoredServerTokens>>,
  home = homedir()
): void {
  writeTokenFileAt(servers, tokenFilePath(home))
}

export function isExpired(tokens: Pick<OAuthTokens, 'expiresAt'>, skewMs = 30_000): boolean {
  return Date.now() + skewMs >= tokens.expiresAt
}

/** Split server ids into fresh (skip) vs needing approval. */
export function partitionServers(
  ids: CloudflareServerId[],
  stored: Partial<Record<CloudflareServerId, StoredServerTokens>> | undefined
): { fresh: CloudflareServerId[]; needed: CloudflareServerId[] } {
  const fresh: CloudflareServerId[] = []
  const needed: CloudflareServerId[] = []
  for (const id of ids) {
    const entry = stored?.[id]
    if (entry && !isExpired(entry)) fresh.push(id)
    else needed.push(id)
  }
  return { fresh, needed }
}
