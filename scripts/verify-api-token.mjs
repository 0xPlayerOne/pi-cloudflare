#!/usr/bin/env node
/**
 * Verify a Cloudflare API token for pi-cloudflare's `api` server.
 * Read-only: identity, token status, and one probe per audit domain.
 *
 * Status legend:
 *   ok     2xx — group present and the surface answered
 *   none   404 — group present, no resource configured yet (a ruleset phase
 *                with no entrypoint answers 10003, which is also a pass)
 *   FAIL   403 — the group is missing (JSON body) or the request was
 *                challenge-blocked (HTML body)
 *   plan   401 — entitlement, not scope; adding groups will not help
 *
 * Usage: CLOUDFLARE_API_TOKEN=<token> node scripts/verify-api-token.mjs
 */
const token = process.env.CLOUDFLARE_API_TOKEN
if (!token) {
  console.error('Set CLOUDFLARE_API_TOKEN first (see docs/api-token.md).')
  process.exit(2)
}

const BASE = 'https://api.cloudflare.com/client/v4'
const headers = { Authorization: `Bearer ${token}` }

let failed = 0

async function probe(label, path, method = 'GET') {
  let response
  try {
    response = await fetch(`${BASE}${path}`, { method, headers })
  } catch (error) {
    console.log(`FAIL ${label} (${error.message})`)
    failed++
    return
  }

  const contentType = response.headers.get('content-type') ?? ''
  let code
  let message
  if (contentType.includes('json')) {
    const body = await response.json().catch(() => null)
    code = body?.errors?.[0]?.code
    message = body?.errors?.[0]?.message
  }

  if (response.ok) {
    console.log(`ok   ${label}`)
    return
  }

  // A missing ruleset entrypoint proves the group is present, not absent.
  if (code === 10003) {
    console.log(`none ${label} (no entrypoint configured)`)
    return
  }

  if (response.status === 401) {
    console.log(`plan ${label} (${code ?? ''} ${message ?? 'entitlement'})`)
    return
  }

  if (response.status === 403) {
    console.log(`FAIL ${label} (403 ${code ?? ''} ${message ?? ''})`)
    failed++
    return
  }

  // 404/400 from a live-but-unconfigured endpoint is not a scope failure.
  console.log(`none ${label} (HTTP ${response.status} ${code ?? ''})`)
}

async function discover(path) {
  const response = await fetch(`${BASE}${path}`, { headers })
  const body = await response.json().catch(() => null)
  return body?.result ?? []
}

console.log('--- Identity and membership ---')
await probe('identity (/user)', '/user')
await probe('token status (/user/tokens/verify)', '/user/tokens/verify')
await probe('accounts list (/accounts)', '/accounts?per_page=5')
await probe('memberships (/user/memberships)', '/user/memberships?per_page=5')

const accounts = await discover('/accounts?per_page=50')
const zones = await discover('/zones?per_page=50')
console.log(`\nDiscovered ${accounts.length} account(s), ${zones.length} zone(s).`)

if (accounts[0]) {
  const a = accounts[0].id
  const now = Date.now()
  console.log(`\n--- Account scope (${accounts[0].name}) ---`)
  await probe('workers scripts', `/accounts/${a}/workers/scripts`)
  await probe(
    'workers observability usage',
    `/accounts/${a}/workers/observability/usage?from=${now - 3_600_000}&to=${now}`
  )
  // /builds/builds requires filters the API does not document; /builds/tokens
  // proves the same Workers CI Write group and answers unconditionally.
  await probe('workers builds (CI tokens)', `/accounts/${a}/builds/tokens`)
  await probe('d1 databases', `/accounts/${a}/d1/database`)
  await probe('kv namespaces', `/accounts/${a}/storage/kv/namespaces?per_page=1`)
  await probe('r2 buckets', `/accounts/${a}/r2/buckets`)
  await probe('hyperdrive configs', `/accounts/${a}/hyperdrive/configs`)
  await probe('images', `/accounts/${a}/images/v1?per_page=5`)
  await probe('workers ai models', `/accounts/${a}/ai/models/search?per_page=5`)
  await probe('vectorize indexes', `/accounts/${a}/vectorize/v2/indexes`)
  await probe('pages projects', `/accounts/${a}/pages/projects`)
  await probe('account rulesets', `/accounts/${a}/rulesets`)
  await probe('security center insights', `/accounts/${a}/security-center/insights?per_page=5`)
  await probe('account dns settings', `/accounts/${a}/dns_settings`)
  await probe('access apps', `/accounts/${a}/access/apps`)
  await probe('access groups', `/accounts/${a}/access/groups`)
  await probe('access identity providers', `/accounts/${a}/access/identity_providers`)
  await probe('access policies', `/accounts/${a}/access/policies?per_page=5`)
  await probe('access service tokens', `/accounts/${a}/access/service_tokens`)
  await probe('zero trust gateway', `/accounts/${a}/gateway`)
  await probe('device posture', `/accounts/${a}/devices/posture`)
  await probe('turnstile widgets', `/accounts/${a}/challenges/widgets`)
  await probe('cloudflare tunnels', `/accounts/${a}/cfd_tunnel`)
  await probe('notifications policies', `/accounts/${a}/alerting/v3/policies`)
  await probe('audit logs', `/accounts/${a}/audit_logs?per_page=1`)
  await probe('logpush jobs (Logs Write)', `/accounts/${a}/logpush/jobs`)
}

if (zones[0]) {
  const z = zones[0].id
  console.log(`\n--- Zone scope (${zones[0].name}) ---`)
  await probe('dns records', `/zones/${z}/dns_records?per_page=1`)
  await probe('dnssec', `/zones/${z}/dnssec`)
  await probe('zone settings', `/zones/${z}/settings`)
  await probe('zone rulesets', `/zones/${z}/rulesets`)
  await probe('page rules', `/zones/${z}/pagerules`)
  await probe('snippets', `/zones/${z}/snippets`)
  await probe('certificate packs', `/zones/${z}/ssl/certificate_packs`)
  await probe('bot management', `/zones/${z}/bot_management`)
  await probe('page shield scripts', `/zones/${z}/page_shield/scripts`)
  await probe('security center insights', `/zones/${z}/security-center/insights?per_page=5`)
  await probe('api gateway operations', `/zones/${z}/api_gateway/operations?per_page=5`)
  await probe('health checks', `/zones/${z}/healthchecks`)
  await probe('load balancers', `/zones/${z}/load_balancers`)
  await probe('waiting rooms', `/zones/${z}/waiting_rooms`)
  await probe('email routing', `/zones/${z}/email/routing`)

  console.log('\n--- Zone ruleset phases (group presence) ---')
  for (const phase of [
    'http_request_cache_settings',
    'http_response_compression',
    'http_response_headers_transform',
    'http_request_transform',
    'http_request_origin',
    'http_config_settings',
    'http_request_dynamic_redirect',
    'http_request_firewall_custom',
    'http_request_firewall_managed',
  ]) {
    await probe(phase, `/zones/${z}/rulesets/phases/${phase}/entrypoint`)
  }

  console.log('\n--- Analytics (GraphQL is the live surface) ---')
  await probe('graphql analytics', '/graphql', 'POST')
}

console.log(`\n${failed === 0 ? 'All scope checks passed.' : `${failed} scope check(s) FAILED.`}`)
process.exit(failed === 0 ? 0 : 1)
