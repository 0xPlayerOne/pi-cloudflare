#!/usr/bin/env node
/**
 * Verify a Cloudflare API token for pi-cloudflare's `api` server.
 * Read-only: identity, token status, and one Workers scripts read.
 *
 * Usage: CLOUDFLARE_API_TOKEN=<token> node scripts/verify-api-token.mjs
 */
const token = process.env.CLOUDFLARE_API_TOKEN
if (!token) {
  console.error('Set CLOUDFLARE_API_TOKEN first (see docs/api-token.md).')
  process.exit(2)
}

const headers = { Authorization: `Bearer ${token}` }
let failed = false
async function check(name, path) {
  try {
    const response = await fetch(`https://api.cloudflare.com/client/v4${path}`, { headers })
    console.log(`${response.ok ? 'ok  ' : 'FAIL'} ${name} (HTTP ${response.status})`)
    if (!response.ok) failed = true
    return response.ok
  } catch (error) {
    console.log(`FAIL ${name} (${error.message})`)
    failed = true
    return false
  }
}

await check('identity (/user)', '/user')
await check('token status (/user/tokens/verify)', '/user/tokens/verify')
await check('accounts list (/accounts)', '/accounts?per_page=5')
await check('memberships (/user/memberships)', '/user/memberships?per_page=5')
process.exit(failed ? 1 : 0)
