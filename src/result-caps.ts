import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'

/**
 * Guardrail against unbounded upstream MCP text results landing verbatim in
 * agent context. Provenance: one `cf_bindings_workers_get_worker_code` call
 * returned the entire deployed Worker bundle as multipart text (~6 MB), and
 * the agent fetched it twice — 12 MB of session JSONL for a metadata
 * question. Every proxied tool result passes through here.
 *
 * Text blocks larger than the cap are replaced with a bounded preview plus
 * an exact recovery hint (which tool was called, total vs returned bytes).
 * Errors and non-text content pass through untouched.
 */

export const DEFAULT_MAX_TEXT_BYTES = 32_768
export const MAX_TEXT_BYTES_ENV = 'PI_CLOUDFLARE_MAX_TEXT_BYTES'

const TRUNCATION_SUFFIX_RESERVE = 1024

function configuredMaxBytes(): number {
  const raw = process.env[MAX_TEXT_BYTES_ENV]
  if (!raw) return DEFAULT_MAX_TEXT_BYTES
  const parsed = Number(raw)
  if (!Number.isInteger(parsed) || parsed <= 0) return DEFAULT_MAX_TEXT_BYTES
  return parsed
}

function byteLength(text: string): number {
  return Buffer.byteLength(text, 'utf8')
}

function truncateUtf8(text: string, maxBytes: number): string {
  if (byteLength(text) <= maxBytes) return text
  const buffer = Buffer.from(text, 'utf8').subarray(0, maxBytes)
  // Avoid emitting a half-decoded trailing character.
  return buffer.toString('utf8').replace(/\uFFFD+$/, '')
}

function truncationNotice(toolName: string, totalBytes: number, returnedBytes: number): string {
  return (
    `\n\n[pi-cloudflare] TRUNCATED: '${toolName}' returned ${totalBytes} bytes of text; ` +
    `showing the first ${returnedBytes} bytes to protect agent context. ` +
    `Re-run with a narrower query, a specific module/path argument, or pagination ` +
    `instead of fetching the full payload again. ` +
    `Override locally with ${MAX_TEXT_BYTES_ENV} if you genuinely need more.`
  )
}

function isTextBlock(
  block: unknown
): block is { type: 'text'; text: string } & Record<string, unknown> {
  return (
    !!block &&
    typeof block === 'object' &&
    (block as { type?: unknown }).type === 'text' &&
    typeof (block as { text?: unknown }).text === 'string'
  )
}

/**
 * Cap every text block of a proxied `CallToolResult`. Returns the original
 * object when nothing exceeds the cap so small results stay referentially
 * identical.
 */
export function capToolResultText(
  toolName: string,
  result: CallToolResult,
  maxBytes: number = configuredMaxBytes()
): CallToolResult {
  if (!result || !Array.isArray(result.content)) return result
  let truncated = false
  const content = result.content.map((block) => {
    if (!isTextBlock(block)) return block
    const total = byteLength(block.text)
    if (total <= maxBytes) return block
    truncated = true
    const notice = truncationNotice(toolName, total, maxBytes)
    const previewBytes = Math.max(0, maxBytes - byteLength(notice) - TRUNCATION_SUFFIX_RESERVE)
    return { ...block, text: `${truncateUtf8(block.text, previewBytes)}${notice}` }
  })
  if (!truncated) return result
  return { ...result, content }
}

/** Resolve the effective per-text-block cap (exported for tests and docs). */
export function maxTextBytes(): number {
  return configuredMaxBytes()
}
