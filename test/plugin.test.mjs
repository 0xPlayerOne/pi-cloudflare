import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const readJson = (path) =>
  JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'))

describe('Agent Plugins 1.0 package', () => {
  it('ships a version-synchronized plugin manifest', () => {
    const pkg = readJson('package.json')
    const plugin = readJson('plugin.json')
    assert.equal(plugin.$schema, 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json')
    assert.equal(plugin.name, 'pi-cloudflare')
    assert.equal(plugin.version, pkg.version)
    assert.deepEqual(
      Object.keys(plugin).filter(
        (key) =>
          ![
            '$schema',
            'name',
            'version',
            'description',
            'author',
            'homepage',
            'repository',
            'license',
            'keywords',
            'extensions',
          ].includes(key)
      ),
      []
    )
  })

  it('declares one portable stdio MCP gateway with plugin-scoped state', () => {
    const mcp = readJson('mcp.json')
    assert.equal(mcp.$schema, 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json')
    assert.deepEqual(Object.keys(mcp), ['$schema', 'mcpServers'])
    assert.deepEqual(Object.keys(mcp.mcpServers), ['cloudflare'])

    const server = mcp.mcpServers.cloudflare
    assert.equal(server.type, 'stdio')
    assert.equal(server.command, 'node')
    assert.deepEqual(server.args, ['${PLUGIN_ROOT}/dist/mcp-server.js'])
    assert.equal(server.cwd, '${PLUGIN_ROOT}')
    assert.equal(server.env.PI_CLOUDFLARE_PLUGIN_ROOT, '${PLUGIN_ROOT}')
    assert.equal(
      server.env.PI_CLOUDFLARE_TOKEN_FILE,
      '${PLUGIN_DATA}/cloudflare-tokens.json'
    )
  })

  it('includes Agent Plugin entrypoints in the npm tarball allowlist', () => {
    const pkg = readJson('package.json')
    assert.ok(pkg.files.includes('plugin.json'))
    assert.ok(pkg.files.includes('mcp.json'))
    assert.ok(pkg.files.includes('dist'))
    assert.ok(pkg.files.includes('skills'))
  })
})
