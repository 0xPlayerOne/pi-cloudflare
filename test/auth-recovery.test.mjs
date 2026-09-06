import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { isAuthFailure, reauthHint, syncFromFile } from '../dist/index.js'

describe('isAuthFailure', () => {
  it('flags credential rejections', () => {
    for (const message of [
      'Request failed with 401',
      'unauthorized: bad token',
      'invalid_token expired',
      'invalid_grant: refresh rejected',
      'Token refresh failed with 400',
      '403 forbidden for this principal',
    ]) {
      assert.equal(isAuthFailure(new Error(message)), true, message)
    }
  })

  it('ignores operational failures', () => {
    for (const message of [
      'connect api timed out after 30000ms',
      'socket hang up',
      'Browser connection lost; retry the tool.',
      'Tool not found: frobnicate',
    ]) {
      assert.equal(isAuthFailure(new Error(message)), false, message)
    }
  })
})

describe('reauthHint', () => {
  it('names the exact setup command for the server', () => {
    const hint = reauthHint('builds')
    assert.match(hint, /pi-cloudflare-setup --only builds/)
    assert.doesNotMatch(hint, /--oauth/)
  })
})

describe('syncFromFile', () => {
  function setupFile(servers) {
    const home = mkdtempSync(join(tmpdir(), 'pi-cf-sync-'))
    mkdirSync(join(home, '.pi'), { recursive: true })
    writeFileSync(
      join(home, '.pi', 'cloudflare-tokens.json'),
      JSON.stringify({ version: 1, servers })
    )
    return home
  }

  const grant = (access, refresh) => ({
    accessToken: access,
    refreshToken: refresh,
    expiresAt: Date.now() + 3600000,
    clientId: 'client',
    tokenEndpoint: 'https://example.test/token',
  })

  it('adopts a rotated grant from a sibling session', () => {
    const home = setupFile({ api: grant('access-new', 'refresh-new') })
    const entry = { definition: { id: 'api' }, timeoutMs: 1, stored: grant('access-old', 'refresh-old') }
    syncFromFile(entry, home)
    assert.equal(entry.stored.accessToken, 'access-new')
    assert.equal(entry.stored.refreshToken, 'refresh-new')
  })

  it('keeps memory when the file matches', () => {
    const home = setupFile({ api: grant('access-same', 'refresh-same') })
    const stored = grant('access-same', 'refresh-same')
    const entry = { definition: { id: 'api' }, timeoutMs: 1, stored }
    syncFromFile(entry, home)
    assert.equal(entry.stored, stored)
  })

  it('is a no-op without a token file', () => {
    const stored = grant('a', 'r')
    const entry = { definition: { id: 'api' }, timeoutMs: 1, stored }
    syncFromFile(entry, join(tmpdir(), 'pi-cf-sync-missing'))
    assert.equal(entry.stored, stored)
  })
})
