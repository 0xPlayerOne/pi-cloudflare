#!/usr/bin/env node
/**
 * Read-only Cloudflare estate audit.
 *
 * Walks every account and zone the token can see and reports hardening gaps.
 * Makes GET requests only — it never changes anything. Fixes need judgement
 * from the live probe, so they stay with the agent (see ../SKILL.md).
 *
 * Usage:
 *   CLOUDFLARE_API_TOKEN=... node audit.mjs [options]
 *
 * Options:
 *   --json            machine-readable output
 *   --no-probe        skip live HTTP probes (faster, config-only)
 *   --account <id>    limit to one account
 *   --zone <name>     limit to one zone
 *   --help
 *
 * Exit codes: 0 = audit completed, 1 = no usable credential, 2 = fatal error.
 * A finding does not fail the run — this is a report, not a gate.
 */
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const BASE = 'https://api.cloudflare.com/client/v4'
const args = process.argv.slice(2)
const flag = (name) => args.includes(name)
const option = (name) => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}

if (flag('--help')) {
  const source = readFileSync(new URL(import.meta.url), 'utf8')
  const block = source.slice(source.indexOf('/**') + 3, source.indexOf('*/'))
  console.log(
    block
      .split('\n')
      .map((line) => line.replace(/^\s*\* ?/, ''))
      .join('\n')
      .trim()
  )
  process.exit(0)
}

const AS_JSON = flag('--json')
const PROBE = !flag('--no-probe')
const ONLY_ACCOUNT = option('--account')
const ONLY_ZONE = option('--zone')

/** Resolve the token the same way the extension does: env, then the native Pi file. */
function resolveToken() {
  if (process.env.CLOUDFLARE_API_TOKEN?.trim()) return process.env.CLOUDFLARE_API_TOKEN.trim()
  try {
    const contents = readFileSync(join(homedir(), '.pi', 'cloudflare-api-token'), 'utf8')
    const match =
      /^\s*export\s+CLOUDFLARE_API_TOKEN=(?:"([^"\r\n]*)"|'([^'\r\n]*)'|([^\s#\r\n]+))\s*$/m.exec(contents)
    return match?.[1] || match?.[2] || match?.[3] || undefined
  } catch {
    return undefined
  }
}

const token = resolveToken()
if (!token) {
  console.error('No credential found. Set CLOUDFLARE_API_TOKEN or create ~/.pi/cloudflare-api-token.')
  console.error('See the cloudflare-api-token skill for how to mint one.')
  process.exit(1)
}

const HEADERS = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }

/** GET a path, returning { status, result, error }. Never throws on HTTP errors. */
async function get(path) {
  try {
    const response = await fetch(`${BASE}${path}`, { headers: HEADERS })
    const contentType = response.headers.get('content-type') ?? ''
    if (!contentType.includes('json')) return { status: response.status, error: `non-JSON response (likely a WAF challenge)` }
    const body = await response.json().catch(() => null)
    if (!response.ok) {
      const err = body?.errors?.[0]
      return { status: response.status, error: `${err?.code ?? ''} ${err?.message ?? ''}`.trim() }
    }
    return { status: response.status, result: body?.result }
  } catch (error) {
    return { status: 0, error: error.message }
  }
}

// Settings that harden a zone, with the target value and why.
const SETTING_BASELINE = {
  min_tls_version: { target: '1.2', why: 'TLS 1.0/1.1 are deprecated and dropped by browsers' },
  always_use_https: { target: 'on', why: 'redirect http to https' },
  automatic_https_rewrites: { target: 'on', why: 'rewrite mixed-content links' },
  tls_1_3: { target: 'zrt', why: 'TLS 1.3 with zero-round-trip resumption' },
  '0rtt': { target: 'on', why: 'skip a round trip on repeat visits' },
  early_hints: { target: 'on', why: 'HTTP 103 preloads critical assets' },
  brotli: { target: 'on', why: 'compression' },
  http2: { target: 'on', why: 'protocol' },
  http3: { target: 'on', why: 'protocol' },
  websockets: { target: 'on', why: 'protocol' },
  ipv6: { target: 'on', why: 'protocol' },
  development_mode: { target: 'off', why: 'disables caching and optimization; must never be left on' },
}

// Settings whose current value is the user's call, reported but not flagged.
const SETTING_BASELINE_INFO = {
  security_level: { target: 'medium', why: 'raise only during an attack' },
  rocket_loader: { target: 'off', why: 'rewrites JS; can break SPAs' },
}

const RULESET_PHASES = [
  'http_request_firewall_managed',
  'http_response_headers_transform',
  'http_response_compression',
  'http_request_cache_settings',
  'http_request_dynamic_redirect',
  'http_request_origin',
  'http_config_settings',
  'http_request_firewall_custom',
]

// Headers we expect on a hardened content response. HSTS is handled separately
// because enabling includeSubDomains needs care and sign-off.
const EXPECTED_HEADERS = ['x-content-type-options', 'referrer-policy']

const findings = []
const add = (scope, severity, subject, message, action) =>
  findings.push({ scope, severity, subject, message, action })

async function probeHost(hostname) {
  try {
    const response = await fetch(`https://${hostname}/`, {
      redirect: 'manual',
      signal: AbortSignal.timeout(15000),
    })
    const headers = {}
    for (const name of [...EXPECTED_HEADERS, 'strict-transport-security', 'cf-ray']) {
      headers[name] = response.headers.get(name)
    }
    return { status: response.status, headers }
  } catch (error) {
    return { status: 0, error: error.message }
  }
}

async function auditZone(zone) {
  const zoneFindingsStart = findings.length
  const settingsRes = await get(`/zones/${zone.id}/settings`)
  const settings = {}
  for (const item of settingsRes.result ?? []) {
    settings[item.id] = { value: item.value, editable: item.editable }
  }

  if (settingsRes.error) {
    add(zone.name, 'blocked', 'settings', `could not read zone settings: ${settingsRes.error}`, 'check token scope')
  } else {
    for (const [id, { target, why }] of Object.entries(SETTING_BASELINE)) {
      const current = settings[id]
      if (!current) continue
      const normalised = typeof target === 'string' ? String(current.value) : current.value
      if (normalised === target) continue
      if (current.editable === false) {
        add(zone.name, 'gated', id, `${current.value} (target ${target}) — read-only on this plan`, why)
      } else {
        add(zone.name, 'high', id, `${current.value} → ${target}`, why)
      }
    }
    for (const [id, { target, why }] of Object.entries(SETTING_BASELINE_INFO)) {
      const current = settings[id]
      if (!current || String(current.value) === target) continue
      add(zone.name, 'info', id, `currently ${current.value}`, why)
    }
  }

  // Ruleset phases: distinguish "nothing configured" from "cannot read".
  const phases = {}
  for (const phase of RULESET_PHASES) {
    const res = await get(`/zones/${zone.id}/rulesets/phases/${phase}/entrypoint`)
    const code = res.error?.split(' ')[0]
    phases[phase] = res.status === 200 ? ((res.result?.rules?.length ?? 0) > 0 ? 'configured' : 'empty') : code === '10003' ? 'none' : `err:${res.error}`
  }

  if (phases.http_request_firewall_managed === 'none' || phases.http_request_firewall_managed === 'empty') {
    add(
      zone.name,
      'high',
      'managed WAF ruleset',
      'free managed ruleset not applied — zone has no managed WAF coverage',
      'PUT the http_request_firewall_managed entrypoint with an execute rule'
    )
  }
  for (const phase of ['http_response_headers_transform', 'http_response_compression']) {
    if (phases[phase] === 'none') {
      add(zone.name, 'info', phase, 'not configured', 'add rules if the live probe shows a gap')
    }
  }

  // DNSSEC.
  const dnssec = await get(`/zones/${zone.id}/dnssec`)
  const dnssecStatus = dnssec.result?.status
  if (dnssecStatus === 'disabled') {
    add(zone.name, 'high', 'dnssec', 'disabled', 'enable (inert until the registrar publishes the DS), then hand over the DS record')
  } else if (dnssecStatus === 'pending') {
    add(zone.name, 'medium', 'dnssec', 'pending — registrar DS not published', `publish: ${dnssec.result?.ds ?? 'read DS from the API'}`)
  }

  // Bot management (AI bots / fight mode live here, not under /settings).
  // enable_js injects a detection script into every HTML response, so it is a
  // performance finding rather than a security gap. fight_mode is a genuine
  // tradeoff and is reported, not flagged.
  const bot = await get(`/zones/${zone.id}/bot_management`)
  if (bot.result) {
    if (bot.result.enable_js === true) {
      add(
        zone.name,
        'high',
        'javascript detections',
        'injects /cdn-cgi/challenge-platform/scripts/jsd/main.js into every HTML response',
        'turn off (PUT bot_management {enable_js:false}) — it trips Lighthouse Best Practices "deprecated API"'
      )
    }
    if (bot.result.fight_mode === true) {
      add(
        zone.name,
        'info',
        'bot fight mode',
        'on — a real tradeoff, not a free win',
        'adds edge protection but costs roughly 40 Lighthouse Best-Practices points via the injected detection script'
      )
    }
    if (bot.result.ai_bots_protection && bot.result.ai_bots_protection !== 'block') {
      add(zone.name, 'info', 'ai_bots_protection', `currently ${bot.result.ai_bots_protection}`, 'consider "block" — enforced at the edge, injects no script')
    }
  }

  // DNS insight into proxying — the usual reason zone rules appear to do nothing.
  const records = await get(`/zones/${zone.id}/dns_records?per_page=100`)
  let proxied = 0
  let unproxied = 0
  if (Array.isArray(records.result)) {
    for (const record of records.result) {
      if (['TXT', 'MX', 'NS', 'SRV', 'CAA'].includes(record.type)) continue
      if (record.proxied) proxied += 1
      else unproxied += 1
    }
  }

  const zoneResult = { zone: zone.name, account: zone.account?.name, plan: zone.plan?.name, settings, phases, dnssec: dnssecStatus, proxied, unproxied }

  if (PROBE) {
    const live = await probeHost(zone.name)
    zoneResult.live = live
    if (live.status === 0) {
      add(zone.name, 'info', 'live probe', `could not reach the zone: ${live.error}`, 'verify the hostname serves traffic')
    } else if (!live.headers['cf-ray']) {
      add(
        zone.name,
        'high',
        'not proxied',
        'apex response has no cf-ray — traffic bypasses Cloudflare, so NO zone setting, rule, or transform applies',
        'report to the user as an architecture decision; do not proxy third-party hosts to clear it'
      )
    } else if (live.status !== 200) {
      // A redirect or error page has no content body to protect, so missing
      // response headers here are not a real gap. Only note it.
      add(zone.name, 'info', 'no content served', `HTTP ${live.status} at the apex — header checks skipped`, 'check a content hostname')
    } else {
      for (const header of EXPECTED_HEADERS) {
        if (!live.headers[header]) {
          add(zone.name, 'medium', header, 'absent on the live response', 'add via a response-header transform rule if the origin does not set it')
        }
      }
      if (!live.headers['strict-transport-security']) {
        add(zone.name, 'info', 'hsts', 'not served', 'enabling includeSubDomains requires every subdomain to be HTTPS-capable; get sign-off')
      }
    }
  }

  zoneResult.findings = findings.slice(zoneFindingsStart)
  return zoneResult
}

async function auditAccount(account) {
  const accountStart = findings.length
  const summary = { account: account.name, id: account.id, plan: account.plan?.name }

  const quotas = await get(`/accounts/${account.id}/secrets_store/quota`)
  if (quotas.error) {
    add(account.name, 'blocked', 'secrets store', quotas.error, 'grant Secrets Store read to inventory')
  } else {
    summary.secretsStore = quotas.result
  }

  const widgets = await get(`/accounts/${account.id}/challenges/widgets`)
  if (widgets.error) {
    add(account.name, 'blocked', 'turnstile', widgets.error, 'grant Turnstile read to inventory')
  } else {
    summary.turnstileWidgets = (widgets.result ?? []).map((w) => w.name)
    if ((widgets.result ?? []).length === 0) {
      add(account.name, 'info', 'turnstile', 'no widgets', 'free to create; the secret is returned once')
    }
  }

  const apps = await get(`/accounts/${account.id}/access/apps`)
  if (apps.error) {
    add(account.name, 'blocked', 'zero trust', apps.error, 'grant Access read to inventory')
  } else {
    summary.accessApps = (apps.result ?? []).length
  }

  const insights = await get(`/accounts/${account.id}/security-center/insights?per_page=100`)
  if (insights.error) {
    add(account.name, 'blocked', 'security center', insights.error, 'grant Security Center Insights read')
  } else {
    const issues = insights.result?.issues ?? []
    summary.insights = issues.map((i) => ({ class: i.issue_class, severity: i.severity, subject: i.subject }))
    for (const issue of issues) {
      add(account.name, 'info', issue.issue_class, `${issue.severity} — ${issue.subject}`, 'see references/paid-features.md for gated items')
    }
  }

  const domains = await get(`/accounts/${account.id}/registrar/domains?per_page=100`)
  summary.registrarDomains = domains.error
    ? { error: domains.error }
    : (domains.result ?? []).map((d) => ({ name: d.name, dsPublished: (d.ds_records ?? []).length > 0 }))

  summary.findings = findings.slice(accountStart)
  return summary
}

// --- main ---

const accountsRes = await get('/accounts?per_page=50')
if (accountsRes.error) {
  console.error(`Could not list accounts: ${accountsRes.error}`)
  console.error('The token needs account read access. See the cloudflare-api-token skill.')
  process.exit(2)
}
let accounts = accountsRes.result ?? []
if (ONLY_ACCOUNT) accounts = accounts.filter((a) => a.id === ONLY_ACCOUNT || a.name === ONLY_ACCOUNT)

const zonesRes = await get('/zones?per_page=50')
if (zonesRes.error) {
  console.error(`Could not list zones: ${zonesRes.error}`)
  process.exit(2)
}
let zones = zonesRes.result ?? []
if (ONLY_ZONE) zones = zones.filter((z) => z.name === ONLY_ZONE)
if (ONLY_ACCOUNT) {
  const ids = new Set(accounts.map((a) => a.id))
  zones = zones.filter((z) => ids.has(z.account?.id))
}

const auditedZones = []
for (const zone of zones) auditedZones.push(await auditZone(zone))

const auditedAccounts = []
for (const account of accounts) auditedAccounts.push(await auditAccount(account))

const report = {
  generatedAt: new Date().toISOString(),
  accounts: auditedAccounts,
  zones: auditedZones,
  findings,
}

if (AS_JSON) {
  console.log(JSON.stringify(report, null, 2))
} else {
  const order = { high: 0, medium: 1, gated: 2, blocked: 3, info: 4 }
  const sorted = [...findings].sort((a, b) => (order[a.severity] ?? 9) - (order[b.severity] ?? 9))

  console.log(`Cloudflare estate audit — ${accounts.length} account(s), ${zones.length} zone(s)`)
  console.log(`Plans: ${[...new Set(zones.map((z) => z.plan?.name))].join(', ') || 'unknown'}\n`)

  const groups = { high: [], medium: [], gated: [], blocked: [], info: [] }
  for (const finding of sorted) (groups[finding.severity] ?? groups.info).push(finding)

  /**
   * Collapse findings that repeat across many zones into one line, so a report
   * about a large estate stays readable. A distinct message still gets its own
   * line — only exact (subject, message) repeats are aggregated.
   */
  const emit = (label, list) => {
    if (list.length === 0) return
    const collapsed = new Map()
    for (const finding of list) {
      const key = `${finding.subject}\u0000${finding.message}\u0000${finding.action ?? ''}`
      const entry = collapsed.get(key)
      if (entry) {
        entry.scopes.push(finding.scope)
      } else {
        collapsed.set(key, { ...finding, scopes: [finding.scope] })
      }
    }

    console.log(`${label} (${list.length} across ${new Set(list.map((f) => f.scope)).size} subject(s))`)
    for (const entry of collapsed.values()) {
      if (entry.scopes.length === 1) {
        console.log(`  ${entry.scopes[0].padEnd(24)} ${entry.subject.padEnd(32)} ${entry.message}`)
      } else {
        const names = entry.scopes.join(', ')
        const shown = names.length > 90 ? `${names.slice(0, 87)}...` : names
        console.log(`  ${`${entry.scopes.length} zones`.padEnd(24)} ${entry.subject.padEnd(32)} ${entry.message}`)
        console.log(`  ${''.padEnd(24)} ${shown}`)
      }
      if (entry.action && entry.severity !== 'info') console.log(`  ${''.padEnd(24)} → ${entry.action}`)
    }
    console.log('')
  }

  emit('ACTION NEEDED', groups.high)
  emit('WORTH REVIEWING', groups.medium)
  emit('GATED BY PLAN', groups.gated)
  emit('COULD NOT READ (token scope?)', groups.blocked)
  emit('CONTEXT', groups.info)

  const high = groups.high.length
  console.log(high === 0 ? 'No high-severity gaps found.' : `${high} high-severity gap(s) to address.`)
  console.log('\nThis audit changed nothing. Read ../SKILL.md before applying fixes —')
  console.log('several endpoints return HTTP 200 without applying the change.')
}
