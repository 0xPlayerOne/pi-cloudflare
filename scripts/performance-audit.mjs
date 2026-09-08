#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const checking = process.argv.includes('--check')
const jsonOutput = process.argv.includes('--json')
const budgets = JSON.parse(readFileSync(join(root, 'performance-budget.json'), 'utf8'))

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    ...options,
  })
  if (result.status !== 0) {
    const detail = [result.stdout, result.stderr].filter(Boolean).join('\n').trim()
    throw new Error(`${command} ${args.join(' ')} failed${detail ? `:\n${detail}` : ''}`)
  }
  return result.stdout.trim()
}

function percentile(values, fraction) {
  const sorted = values.toSorted((a, b) => a - b)
  return sorted[Math.ceil(sorted.length * fraction) - 1]
}

function filesBelow(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    return entry.isDirectory() ? filesBelow(path) : [path]
  })
}

function round(value, decimalPlaces = 3) {
  const scale = 10 ** decimalPlaces
  return Math.round(value * scale) / scale
}

const buildStarted = performance.now()
run(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'build', '--silent'])
const buildMs = performance.now() - buildStarted

const importProbe = [
  "import { performance } from 'node:perf_hooks'",
  'const started = performance.now()',
  `await import(${JSON.stringify(pathToFileURL(join(root, 'dist/index.js')).href)})`,
  'process.stdout.write(String(performance.now() - started))',
].join(';')
const coldStarts = Array.from({ length: 7 }, () =>
  Number(run(process.execPath, ['--input-type=module', '--eval', importProbe]))
)

const { buildToolRegistrations } = await import('../dist/proxy.js')
const tool = {
  name: 'search',
  description: 'Benchmark fixture',
  inputSchema: { type: 'object', properties: { q: { type: 'string' } } },
}
const [registration] = buildToolRegistrations('cf_docs_', [tool], async (_name, params) => ({
  content: [{ type: 'text', text: String(params.q) }],
}))
for (let index = 0; index < 250; index += 1) {
  await registration.execute(`warmup-${index}`, { q: 'workers' })
}
const requestLatencies = []
for (let index = 0; index < 5000; index += 1) {
  const started = performance.now()
  await registration.execute(`benchmark-${index}`, { q: 'workers' })
  requestLatencies.push(performance.now() - started)
}

const distFiles = filesBelow(join(root, 'dist'))
const distBytes = distFiles.reduce((total, path) => total + statSync(path).size, 0)
const pack = JSON.parse(
  run(process.platform === 'win32' ? 'npm.cmd' : 'npm', [
    'pack',
    '--dry-run',
    '--json',
    '--ignore-scripts',
  ])
)[0]
const packageFiles = new Set(pack.files.map((file) => file.path))
const requiredPackageFiles = [
  'bin/setup.mjs',
  'dist/index.js',
  'dist/index.d.ts',
  'skills/cloudflare/SKILL.md',
]
const forbiddenPackagePrefixes = ['src/', 'test/', 'scripts/']
const missingPackageFiles = requiredPackageFiles.filter((path) => !packageFiles.has(path))
const forbiddenPackageFiles = [...packageFiles].filter((path) =>
  forbiddenPackagePrefixes.some((prefix) => path.startsWith(prefix))
)

const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'))
const productionDependencies = Object.entries(lock.packages).filter(
  ([path, metadata]) => path && metadata.dev !== true
).length

const metrics = {
  buildMs: round(buildMs),
  coldStartP95Ms: round(percentile(coldStarts, 0.95)),
  proxyRequestP95Ms: round(percentile(requestLatencies, 0.95), 6),
  distBytes,
  packedBytes: pack.size,
  unpackedBytes: pack.unpackedSize,
  productionDependencies,
  packageEntries: pack.entryCount,
}

const failures = Object.entries(budgets)
  .filter(([metric, maximum]) => metrics[metric] > maximum)
  .map(([metric, maximum]) => `${metric}: ${metrics[metric]} exceeds ${maximum}`)
if (missingPackageFiles.length > 0) {
  failures.push(`publish artifact is missing: ${missingPackageFiles.join(', ')}`)
}
if (forbiddenPackageFiles.length > 0) {
  failures.push(`publish artifact unexpectedly includes: ${forbiddenPackageFiles.join(', ')}`)
}

const result = {
  metrics,
  budgets,
  artifactContract: {
    required: requiredPackageFiles,
    forbiddenPrefixes: forbiddenPackagePrefixes,
    valid: missingPackageFiles.length === 0 && forbiddenPackageFiles.length === 0,
  },
  passed: failures.length === 0,
}

if (jsonOutput) {
  console.log(JSON.stringify(result, null, 2))
} else {
  console.log('Performance audit')
  for (const [metric, value] of Object.entries(metrics)) {
    console.log(`  ${metric}: ${value} (budget: ${budgets[metric]})`)
  }
  console.log(`  publishArtifact: ${result.artifactContract.valid ? 'valid' : 'invalid'}`)
}

if (failures.length > 0) {
  console.error(`Performance regressions:\n- ${failures.join('\n- ')}`)
  if (checking) process.exitCode = 1
}
