import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { CLOUDFLARE_SERVERS, serverById } from '../dist/servers.js'

describe('servers', () => {
  it('defines exactly the five documented Cloudflare MCP servers', () => {
    assert.deepEqual(
      CLOUDFLARE_SERVERS.map((server) => server.id),
      ['api', 'docs', 'bindings', 'builds', 'observability']
    )
  })

  it('uses unique cf_ prefixes and https mcp endpoints', () => {
    const prefixes = CLOUDFLARE_SERVERS.map((server) => server.prefix)
    assert.equal(new Set(prefixes).size, prefixes.length)
    for (const server of CLOUDFLARE_SERVERS) {
      assert.match(server.prefix, /^cf_[a-z]+_$/)
      assert.ok(server.url.startsWith('https://'))
      assert.ok(server.url.endsWith('/mcp'))
    }
  })

  it('resolves by id and rejects unknown ids', () => {
    assert.equal(serverById('docs').prefix, 'cf_docs_')
    assert.throws(() => serverById('nope'), /Unknown Cloudflare MCP server/)
  })
})
