import { describe, it, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:http'

import { CloudflareRuntime } from '../dist/runtime.js'
import { updateToolCacheAt } from '../dist/tool-cache.js'

const TOOLS = [
  { name: 'probe_tool', description: 'probe', inputSchema: { type: 'object', properties: {} } },
]

const API_ONLY = { servers: { docs: false, bindings: false, builds: false, observability: false } }
const BINDINGS_ONLY = { servers: { api: false, docs: false, builds: false, observability: false } }

function grant(access, refresh, expiresAt = Date.now() + 3_600_000, tokenEndpoint) {
  return {
    accessToken: access,
    refreshToken: refresh,
    expiresAt,
    clientId: 'client',
    tokenEndpoint: tokenEndpoint ?? 'http://127.0.0.1:9/token',
  }
}

function fakeConnection({ callTool, listTools } = {}) {
  return {
    definition: {},
    listTools: async () => listTools ?? TOOLS,
    callTool: callTool ?? (async () => ({ content: [{ type: 'text', text: 'ok' }] })),
    close: async () => {},
  }
}

const openSessions = []

function harness({ config = {}, stored, cached, callTool, connect } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'pi-cf-lazy-'))
  const tokenFile = join(dir, 'cloudflare-tokens.json')
  const toolsCache = join(dir, 'cloudflare-tools-cache.json')
  if (stored) writeFileSync(tokenFile, JSON.stringify({ version: 1, servers: stored }))
  for (const [id, tools] of Object.entries(cached ?? {})) updateToolCacheAt(id, tools, toolsCache)
  const connects = []
  const warnings = []
  const runtime = new CloudflareRuntime({
    config,
    tokenFile,
    toolsCache,
    warn: (message) => warnings.push(message),
    connect:
      connect ??
      ((definition, options) => {
        connects.push({ id: definition.id, apiToken: options.apiToken })
        return fakeConnection({ callTool })
      }),
  })
  const session = {
    runtime,
    connects,
    warnings,
    tokenFile,
    toolsCache,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  }
  openSessions.push(session)
  return session
}

afterEach(() => {
  while (openSessions.length) openSessions.pop().cleanup()
})

describe('lazy runtime start', () => {
  it('registers from a warm cache without connecting', async () => {
    const session = harness({ config: API_ONLY, cached: { api: TOOLS } })
    const registrations = await session.runtime.start()
    assert.deepEqual(session.connects, [])
    assert.deepEqual(
      registrations.map((registration) => registration.name),
      ['cf_api_probe_tool']
    )
  })

  it('connects on first tool call and sends the static API token', async () => {
    const session = harness({
      config: { ...API_ONLY, apiToken: 'static-token' },
      cached: { api: TOOLS },
    })
    const [tool] = await session.runtime.start()
    assert.deepEqual(session.connects, [])
    const result = await tool.execute('call-1', {})
    assert.equal(result.content[0].text, 'ok')
    assert.deepEqual(session.connects, [{ id: 'api', apiToken: 'static-token' }])
  })

  it('reuses the live connection for later calls', async () => {
    const session = harness({
      config: { ...API_ONLY, apiToken: 'static-token' },
      cached: { api: TOOLS },
    })
    const [tool] = await session.runtime.start()
    await tool.execute('call-1', {})
    await tool.execute('call-2', {})
    assert.equal(session.connects.length, 1)
  })

  it('uses the API token for OAuth-only servers and never refreshes their grants', async () => {
    const session = harness({
      config: { ...BINDINGS_ONLY, apiToken: 'static-token' },
      // Expired grant with an unroutable token endpoint: any refresh attempt would throw.
      stored: { bindings: grant('old-access', 'old-refresh', Date.now() - 1_000) },
      cached: { bindings: TOOLS },
    })
    const [tool] = await session.runtime.start()
    assert.deepEqual(session.connects, [])
    await tool.execute('call-1', {})
    assert.deepEqual(session.connects, [{ id: 'bindings', apiToken: 'static-token' }])
  })

  it('connects with the stored access token when no API token is set', async () => {
    const session = harness({
      config: API_ONLY,
      stored: { api: grant('access-1', 'refresh-1') },
      cached: { api: TOOLS },
    })
    const [tool] = await session.runtime.start()
    await tool.execute('call-1', {})
    assert.deepEqual(session.connects, [{ id: 'api', apiToken: 'access-1' }])
  })

  it('discovers tools eagerly only when no cache exists, then caches them', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pi-cf-lazy-disc-'))
    try {
      const paths = {
        config: { ...API_ONLY, apiToken: 'static-token' },
        tokenFile: join(dir, 'cloudflare-tokens.json'),
        toolsCache: join(dir, 'cloudflare-tools-cache.json'),
      }
      const connects = []
      const connect = (definition, options) => {
        connects.push({ id: definition.id, apiToken: options.apiToken })
        return fakeConnection()
      }
      const first = new CloudflareRuntime({ ...paths, connect })
      const registrations = await first.start()
      assert.deepEqual(connects, [{ id: 'api', apiToken: 'static-token' }])
      assert.deepEqual(
        registrations.map((registration) => registration.name),
        ['cf_api_probe_tool']
      )
      assert.equal(existsSync(paths.toolsCache), true)

      const second = new CloudflareRuntime({ ...paths, connect })
      await second.start()
      assert.equal(connects.length, 1)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('adopts a cache written by a sibling session without connecting', async () => {
    const first = harness({ config: { ...API_ONLY, apiToken: 'static-token' } })
    const second = harness({ config: { ...API_ONLY, apiToken: 'static-token' } })
    await first.runtime.start() // discovers eagerly and populates its cache
    copyFileSync(first.toolsCache, second.toolsCache)
    await second.runtime.start()
    assert.deepEqual(second.connects, [])
  })

  it('discovery failure without an API token still offers the reauthenticate tool', async () => {
    const session = harness({
      config: API_ONLY,
      connect: async () => {
        throw new Error('Request failed with 401')
      },
    })
    const registrations = await session.runtime.start()
    assert.deepEqual(
      registrations.map((registration) => registration.name),
      ['cf_api_reauthenticate']
    )
    assert.equal(
      session.warnings.some((message) => /pi-cloudflare-setup --only api/.test(message)),
      true
    )
  })

  it('discovery failure with an API token never suggests browser OAuth', async () => {
    const session = harness({
      config: { ...API_ONLY, apiToken: 'static-token' },
      connect: async () => {
        throw new Error('Request failed with 401')
      },
    })
    const registrations = await session.runtime.start()
    assert.deepEqual(
      registrations.map((registration) => registration.name),
      []
    )
    assert.equal(
      session.warnings.some((message) => /check the configured API token/i.test(message)),
      true
    )
    assert.equal(
      session.warnings.some((message) => /pi-cloudflare-setup|browser/.test(message)),
      false
    )
  })
})

describe('call-time auth recovery', () => {
  it('wraps static-token rejections without any OAuth hint', async () => {
    const session = harness({
      config: { ...API_ONLY, apiToken: 'static-token' },
      cached: { api: TOOLS },
      callTool: async () => {
        throw new Error('Request failed with 401')
      },
    })
    const [tool] = await session.runtime.start()
    await assert.rejects(tool.execute('call-1', {}), (error) => {
      assert.match(error.message, /Check the configured API token/)
      assert.doesNotMatch(error.message, /browser|OAuth|pi-cloudflare-setup/)
      return true
    })
  })

  it('refreshes a rejected OAuth grant at call time and retries', async () => {
    const refreshes = []
    const refreshServer = createServer((request, response) => {
      refreshes.push(request.url)
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify({ access_token: 'access-2', expires_in: 3600 }))
    })
    await new Promise((resolve) => refreshServer.listen(0, '127.0.0.1', resolve))
    const port = refreshServer.address().port
    try {
      let calls = 0
      const session = harness({
        config: API_ONLY,
        stored: {
          api: grant(
            'access-1',
            'refresh-1',
            Date.now() + 3_600_000,
            `http://127.0.0.1:${port}/token`
          ),
        },
        cached: { api: TOOLS },
        callTool: async () => {
          calls++
          if (calls === 1) throw new Error('Request failed with 401')
          return { content: [{ type: 'text', text: 'ok-after-refresh' }] }
        },
      })
      const [tool] = await session.runtime.start()
      const result = await tool.execute('call-1', {})
      assert.equal(result.content[0].text, 'ok-after-refresh')
      assert.equal(refreshes.length, 1)
      assert.deepEqual(
        session.connects.map((connect) => connect.apiToken),
        ['access-1', 'access-2']
      )
      const persisted = JSON.parse(readFileSync(session.tokenFile, 'utf8'))
      assert.equal(persisted.servers.api.accessToken, 'access-2')
    } finally {
      refreshServer.close()
    }
  })

  it('surfaces the recovery hint when a grant without a refresh token is rejected', async () => {
    const session = harness({
      config: API_ONLY,
      stored: { api: grant('access-1', undefined) },
      cached: { api: TOOLS },
      callTool: async () => {
        throw new Error('Request failed with 401')
      },
    })
    const [tool] = await session.runtime.start()
    await assert.rejects(tool.execute('call-1', {}), /pi-cloudflare-setup --only api/)
  })
})
