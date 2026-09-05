import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'

import {
  isExpired,
  partitionServers,
  readTokenFile,
  tokenFilePath,
  writeTokenFile,
} from '../dist/token-store.js'

describe('token-store', () => {
  let home
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'pi-cf-'))
  })
  afterEach(() => {
    rmSync(home, { recursive: true, force: true })
  })

  it('returns undefined when no file exists', () => {
    assert.equal(readTokenFile(home), undefined)
  })

  it('round-trips per-server tokens with owner-only permissions', () => {
    const servers = {
      api: {
        accessToken: 'at-1',
        refreshToken: 'rt-1',
        expiresAt: Date.now() + 3600_000,
        clientId: 'client-1',
        tokenEndpoint: 'https://mcp.example.com/token',
      },
    }
    writeTokenFile(servers, home)
    assert.equal(statSync(tokenFilePath(home)).mode & 0o777, 0o600)
    assert.deepEqual(readTokenFile(home)?.servers, servers)
  })

  it('rejects corrupt files instead of throwing', () => {
    mkdirSync(dirname(tokenFilePath(home)), { recursive: true })
    writeFileSync(tokenFilePath(home), '')
    assert.equal(readTokenFile(home), undefined)
  })

  it('detects expiry with skew', () => {
    assert.equal(isExpired({ expiresAt: Date.now() - 1000 }), true)
    assert.equal(isExpired({ expiresAt: Date.now() + 3600_000 }), false)
  })

  it('partitions fresh vs needing approval', () => {
    const freshEntry = {
      accessToken: 'a',
      expiresAt: Date.now() + 3600_000,
      clientId: 'c',
      tokenEndpoint: 'https://x/token',
    }
    const staleEntry = { ...freshEntry, expiresAt: Date.now() - 1000 }
    assert.deepEqual(partitionServers(['api', 'docs'], { api: freshEntry }), {
      fresh: ['api'],
      needed: ['docs'],
    })
    assert.deepEqual(partitionServers(['api'], { api: staleEntry }), {
      fresh: [],
      needed: ['api'],
    })
    assert.deepEqual(partitionServers(['api'], undefined), { fresh: [], needed: ['api'] })
  })
})
