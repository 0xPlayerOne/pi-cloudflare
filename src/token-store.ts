import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import type { CloudflareServerId } from './servers.js'
import type { OAuthTokens } from './oauth.js'

export interface StoredServerTokens extends OAuthTokens {
  clientId: string
  tokenEndpoint: string
}

interface TokenFile {
  version: 1
  servers: Partial<Record<CloudflareServerId, StoredServerTokens>>
}

export function tokenFilePath(home = homedir()): string {
  return join(home, '.pi', 'cloudflare-tokens.json')
}

/** Read stored per-server OAuth tokens. Missing file means not authenticated. */
export function readTokenFile(home = homedir()): TokenFile | undefined {
  const path = tokenFilePath(home)
  if (!existsSync(path)) return undefined
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as TokenFile
    if (parsed?.version !== 1 || typeof parsed.servers !== 'object') return undefined
    return parsed
  } catch {
    return undefined
  }
}

/** Persist per-server tokens with owner-only permissions. Never logs values. */
export function writeTokenFile(
  servers: Partial<Record<CloudflareServerId, StoredServerTokens>>,
  home = homedir()
): void {
  const path = tokenFilePath(home)
  mkdirSync(join(home, '.pi'), { recursive: true })
  writeFileSync(path, JSON.stringify({ version: 1, servers }, null, 2) + '\n', {
    mode: 0o600,
  })
  chmodSync(path, 0o600)
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
