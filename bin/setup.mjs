#!/usr/bin/env node
/**
 * pi-cloudflare setup: one-time browser OAuth for every Cloudflare MCP
 * server. Each server is its own OAuth issuer, so approval happens once per
 * server (docs needs none).
 *
 * Native Pi defaults to ~/.pi/cloudflare-tokens.json. Agent Plugins clients
 * pass --token-file with their ${PLUGIN_DATA} path so credentials remain
 * client-local and do not require Pi to be installed.
 *
 * Usage:
 *   pi-cloudflare-setup
 *   pi-cloudflare-setup --only builds
 *   pi-cloudflare-setup --only api,observability
 *   pi-cloudflare-setup --token-file /path/to/cloudflare-tokens.json --only api
 *
 * Nothing secret is ever logged or written anywhere else.
 */
import { connectAll } from '../dist/client.js'
import { CLOUDFLARE_SERVERS } from '../dist/servers.js'
import { runOAuthFlow } from '../dist/auth-flow.js'
import {
  partitionServers,
  readTokenFile,
  readTokenFileAt,
  writeTokenFile,
  writeTokenFileAt,
} from '../dist/token-store.js'

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

const tokenFile = argValue('--token-file')
const readStore = () => (tokenFile ? readTokenFileAt(tokenFile) : readTokenFile())
const writeStore = (servers) =>
  tokenFile ? writeTokenFileAt(servers, tokenFile) : writeTokenFile(servers)

const only = parseOnly()
const wanted = only ?? AUTHED_IDS
const file = readStore() ?? { version: 1, servers: {} }
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
      const { tokens, clientId, tokenEndpoint } = await runOAuthFlow(definition)
      file.servers[id] = { ...tokens, clientId, tokenEndpoint }
      writeStore(file.servers)
      console.log(`[${index}/${needed.length}] ${id}: authorized and stored\n`)
    } catch (error) {
      console.log(
        `[${index}/${needed.length}] ${id}: FAILED (${error instanceof Error ? error.message : String(error)})\n`
      )
    }
  }
}

console.log('Verifying all servers...\n')
const stored = readStore()
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
  const tokenArg = tokenFile ? ` --token-file ${JSON.stringify(tokenFile)}` : ''
  console.log(`Re-authenticate with: pi-cloudflare-setup${tokenArg} --only ${failed.join(',')}`)
  process.exit(1)
}
