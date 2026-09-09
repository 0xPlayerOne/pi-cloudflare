import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { buildToolRegistrations } from '../dist/proxy.js'
import {
  capToolResultText,
  DEFAULT_MAX_TEXT_BYTES,
  MAX_TEXT_BYTES_ENV,
  maxTextBytes,
} from '../dist/result-caps.js'

const searchTool = {
  name: 'search',
  description: 'Search things',
  inputSchema: { type: 'object', properties: { q: { type: 'string' } } },
}

describe('result caps', () => {
  it('exposes a sane default cap', () => {
    assert.equal(DEFAULT_MAX_TEXT_BYTES, 32_768)
    assert.equal(maxTextBytes(), 32_768)
  })

  it('passes small results through untouched', () => {
    const result = { content: [{ type: 'text', text: 'ok' }] }
    assert.equal(capToolResultText('cf_bindings_workers_get_worker', result), result)
  })

  it('passes non-text and error content through untouched', () => {
    const error = { content: [{ type: 'text', text: 'nope' }], isError: true }
    const capped = capToolResultText('cf_api_search', error)
    assert.equal(capped.isError, true)
    assert.equal(capped.content[0].text, 'nope')

    const resource = { content: [{ type: 'resource', resource: { uri: 'x' } }] }
    assert.equal(capToolResultText('cf_api_search', resource), resource)
  })

  it('truncates oversized text with a recovery notice', () => {
    const big = 'x'.repeat(DEFAULT_MAX_TEXT_BYTES + 10_000)
    const capped = capToolResultText('cf_bindings_workers_get_worker_code', {
      content: [{ type: 'text', text: big }],
    })
    const text = capped.content[0].text
    assert.ok(Buffer.byteLength(text, 'utf8') <= DEFAULT_MAX_TEXT_BYTES)
    assert.match(text, /TRUNCATED: 'cf_bindings_workers_get_worker_code'/)
    assert.match(text, new RegExp(`${DEFAULT_MAX_TEXT_BYTES + 10_000} bytes of text`))
    assert.match(text, new RegExp(`first ${DEFAULT_MAX_TEXT_BYTES} bytes`))
    assert.match(text, new RegExp(MAX_TEXT_BYTES_ENV))
  })

  it('truncates every oversized block independently', () => {
    const big = 'y'.repeat(DEFAULT_MAX_TEXT_BYTES + 1)
    const capped = capToolResultText('tool', {
      content: [
        { type: 'text', text: 'small' },
        { type: 'text', text: big },
        { type: 'text', text: big },
      ],
    })
    assert.equal(capped.content[0].text, 'small')
    assert.match(capped.content[1].text, /TRUNCATED/)
    assert.match(capped.content[2].text, /TRUNCATED/)
  })

  it('caps proxied tool execution end to end', async () => {
    const big = 'z'.repeat(DEFAULT_MAX_TEXT_BYTES + 5_000)
    const [registration] = buildToolRegistrations('cf_bindings_', [searchTool], async () => ({
      content: [{ type: 'text', text: big }],
    }))
    const result = await registration.execute('call-1', {}, undefined)
    const text = result.content[0].text
    assert.ok(Buffer.byteLength(text, 'utf8') <= DEFAULT_MAX_TEXT_BYTES)
    assert.match(text, /TRUNCATED: 'cf_bindings_search'/)
  })

  it('leaves small proxied results byte-identical', async () => {
    const [registration] = buildToolRegistrations('cf_docs_', [searchTool], async () => ({
      content: [{ type: 'text', text: 'ok' }],
    }))
    const result = await registration.execute('call-1', { q: 'workers' }, undefined)
    assert.deepEqual(result, { content: [{ type: 'text', text: 'ok' }] })
  })
})
