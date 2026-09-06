#!/usr/bin/env node
/**
 * pi-cloudflare setup: one-time browser OAuth for every Cloudflare MCP
 * server. Each server is its own OAuth issuer, so approval happens once per
 * server (docs needs none). Tokens (with refresh) are stored owner-only in
 * ~/.pi/cloudflare-tokens.json and refreshed automatically afterwards.
 *
 * Usage:
 *   pi-cloudflare-setup                  # authorize missing/expired servers
 *   pi-cloudflare-setup --only builds    # re-auth specific servers
 *   pi-cloudflare-setup --only api,observability
 *   pi-cloudflare-setup --scope offline_access  # request extra OAuth scope
 *
 * OAUTH_SCOPE env works like --scope.
 *
 * Nothing secret is ever logged or written anywhere else.
 */
import { connectAll } from '../dist/client.js'
import { CLOUDFLARE_SERVERS } from '../dist/servers.js'
import { runOAuthFlow } from '../dist/auth-flow.js'
import { partitionServers, readTokenFile, writeTokenFile } from '../dist/token-store.js'

const AUTHED_IDS = ['api', 'bindings', 'builds', 'observability']

function argValue(flag) {
  const index = process.argv.indexOf(flag)
  return index >= 0 && index + 1 < process.argv.length ? process.argv[index + 1] : undefined
}

function parseOnly() {
  const raw = argValue('--only')
  if (!raw) return undefined
  const ids = raw
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean)
  const unknown = ids.filter((id) => !AUTHED_IDS.includes(id))
  if (unknown.length > 0) {
    console.log(`Unknown server(s): ${unknown.join(', ')}. Choose from: ${AUTHED_IDS.join(', ')}`)
    process.exit(2)
  }
  return ids
}

const only = parseOnly()
const scope = argValue('--scope') ?? process.env.OAUTH_SCOPE ?? undefined
const wanted = only ?? AUTHED_IDS
const file = readTokenFile() ?? { version: 1, servers: {} }
const { fresh, needed } = partitionServers(wanted, file.servers)

if (fresh.length > 0) {
  console.log(`Already authorized (skipping): ${fresh.join(', ')}\n`)
}
if (needed.length === 0) {
  console.log('All requested servers already authorized. Verifying...\n')
} else {
  console.log(
    `Browser OAuth: ${needed.length} approval tab${needed.length === 1 ? '' : 's'} ` +
      `(${needed.join(', ')}). Approve each; tokens stay on this machine.\n`
  )
  let index = 0
  for (const id of needed) {
    index += 1
    const definition = CLOUDFLARE_SERVERS.find((server) => server.id === id)
    console.log(`[${index}/${needed.length}] Approving ${id} (${definition.url})...`)
    try {
      const { tokens, clientId, tokenEndpoint } = await runOAuthFlow(definition, { scope })
      file.servers[id] = { ...tokens, clientId, tokenEndpoint }
      writeTokenFile(file.servers)
      console.log(`[${index}/${needed.length}] ${id}: authorized and stored\n`)
    } catch (error) {
      console.log(
        `[${index}/${needed.length}] ${id}: FAILED (${error instanceof Error ? error.message : String(error)})\n`
      )
    }
  }
}

console.log('Verifying all servers...\n')
const stored = readTokenFile()
let okCount = 0
const failed = []
for (const definition of CLOUDFLARE_SERVERS) {
  const token = stored?.servers[definition.id]?.accessToken
  const [connection] = await connectAll([definition], { apiToken: token, timeoutMs: 20000 })
  if (!connection) {
    console.log(`- ${definition.id}: unreachable`)
    if (AUTHED_IDS.includes(definition.id)) failed.push(definition.id)
    continue
  }
  try {
    const tools = await connection.listTools()
    console.log(`- ${definition.id}: OK (${tools.length} tools)`)
    okCount += 1
  } catch {
    console.log(`- ${definition.id}: connected but tool discovery failed`)
    if (AUTHED_IDS.includes(definition.id)) failed.push(definition.id)
  } finally {
    await connection.close()
  }
}

console.log(`\n${okCount}/5 servers working.`)
if (failed.length > 0) {
  console.log(`Re-authenticate with: pi-cloudflare-setup --only ${failed.join(',')}`)
  process.exit(1)
}
