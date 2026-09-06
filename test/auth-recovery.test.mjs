import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { isAuthFailure, reauthHint } from '../dist/index.js'

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
