import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { readToolCacheAt, toolsCachePathNear, updateToolCacheAt } from '../dist/tool-cache.js'

const TOOLS = [
  { name: 'probe_tool', description: 'probe', inputSchema: { type: 'object', properties: {} } },
]

describe('tool cache', () => {
  it('derives the cache path from the token file directory', () => {
    assert.equal(
      toolsCachePathNear(join('/data', 'state', 'cloudflare-tokens.json')),
      join('/data', 'state', 'cloudflare-tools-cache.json')
    )
  })

  it('round-trips one server tool list', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pi-cf-cache-'))
    try {
      const path = join(dir, 'cloudflare-tools-cache.json')
      updateToolCacheAt('api', TOOLS, path)
      const cache = readToolCacheAt(path)
      assert.equal(cache?.version, 1)
      assert.equal(typeof cache?.servers.api?.capturedAt, 'number')
      assert.deepEqual(cache?.servers.api?.tools, TOOLS)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('merges per-server updates without clobbering siblings', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pi-cf-cache-'))
    try {
      const path = join(dir, 'cloudflare-tools-cache.json')
      updateToolCacheAt('api', TOOLS, path)
      updateToolCacheAt('docs', [{ name: 'search', inputSchema: {} }], path)
      const cache = readToolCacheAt(path)
      assert.equal(cache?.servers.api?.tools[0].name, 'probe_tool')
      assert.equal(cache?.servers.docs?.tools[0].name, 'search')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('treats a missing, corrupt, or malformed file as no cache', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pi-cf-cache-'))
    try {
      assert.equal(readToolCacheAt(join(dir, 'absent.json')), undefined)

      const corrupt = join(dir, 'corrupt.json')
      writeFileSync(corrupt, '{not json')
      assert.equal(readToolCacheAt(corrupt), undefined)

      const wrongVersion = join(dir, 'wrong-version.json')
      writeFileSync(wrongVersion, JSON.stringify({ version: 2, servers: {} }))
      assert.equal(readToolCacheAt(wrongVersion), undefined)

      const badTools = join(dir, 'bad-tools.json')
      writeFileSync(
        badTools,
        JSON.stringify({ version: 1, servers: { api: { capturedAt: 1, tools: [{}] } } })
      )
      assert.equal(readToolCacheAt(badTools), undefined)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('never writes an empty tool list', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pi-cf-cache-'))
    try {
      const path = join(dir, 'cloudflare-tools-cache.json')
      updateToolCacheAt('api', [], path)
      assert.equal(existsSync(path), false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
