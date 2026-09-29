import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { resolveConfig } from '../dist/config.js'
import { CLOUDFLARE_SERVERS } from '../dist/servers.js'

describe('config', () => {
  it('enables docs and bindings by default and leaves the cf-covered servers opt-in', () => {
    const resolved = resolveConfig(undefined, {})
    assert.deepEqual(resolved.enabledServerIds, ['docs', 'bindings'])
  })

  it('honors per-server opt-in and disable flags', () => {
    const optIn = resolveConfig({ servers: { api: true, builds: true } }, {})
    assert.deepEqual(optIn.enabledServerIds, ['api', 'docs', 'bindings', 'builds'])

    const disabled = resolveConfig({ servers: { docs: false } }, {})
    assert.deepEqual(disabled.enabledServerIds, ['bindings'])
  })

  it('honors explicit enablement overriding the defaults in both directions', () => {
    const all = resolveConfig({
      servers: { api: true, docs: true, bindings: true, builds: true, observability: true },
    })
    assert.deepEqual(
      all.enabledServerIds,
      CLOUDFLARE_SERVERS.map((server) => server.id)
    )
    const none = resolveConfig({
      servers: { api: false, docs: false, bindings: false, builds: false, observability: false },
    })
    assert.deepEqual(none.enabledServerIds, [])
  })

  it('applies a connect timeout override', () => {
    assert.equal(resolveConfig({ connectTimeoutMs: 5000 }).connectTimeoutMs, 5000)
    assert.equal(resolveConfig(undefined).connectTimeoutMs, 30000)
  })
})
