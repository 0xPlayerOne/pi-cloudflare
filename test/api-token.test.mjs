import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { readApiTokenFile, resolveApiToken } from '../dist/api-token.js'

function setupTokenFile(contents) {
  const home = mkdtempSync(join(tmpdir(), 'pi-cf-api-token-'))
  mkdirSync(join(home, '.pi'), { recursive: true })
  writeFileSync(join(home, '.pi', 'cloudflare-api-token'), contents)
  return home
}

describe('native API token fallback', () => {
  it('reads a shell export without evaluating the token file', () => {
    const home = setupTokenFile(
      '# Pi-managed Cloudflare API token (0600).\nexport CLOUDFLARE_API_TOKEN="cfut_test-token"\n'
    )
    assert.equal(readApiTokenFile(home), 'cfut_test-token')
  })

  it('rejects files without the expected export', () => {
    const home = setupTokenFile('CLOUDFLARE_API_TOKEN=cfut_test-token\n')
    assert.equal(readApiTokenFile(home), undefined)
  })

  it('prefers configured and environment tokens over the fallback file', () => {
    const home = setupTokenFile('export CLOUDFLARE_API_TOKEN="file-token"\n')
    assert.equal(resolveApiToken({ apiToken: 'configured-token' }, {}, home), 'configured-token')
    assert.equal(
      resolveApiToken({}, { CLOUDFLARE_API_TOKEN: 'environment-token' }, home),
      'environment-token'
    )
    assert.equal(resolveApiToken({}, {}, home), 'file-token')
  })
})
