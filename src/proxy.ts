import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { Type } from 'typebox'

import type { ServerConnection } from './client.js'

export interface ToolRegistration {
  name: string
  label: string
  description: string
  /** Raw JSON Schema for MCP clients. */
  inputSchema: Record<string, unknown>
  /** TypeBox view of inputSchema for the native Pi host. */
  parameters: unknown
  execute: (
    toolCallId: string,
    params: Record<string, unknown>,
    signal?: AbortSignal
  ) => Promise<CallToolResult>
}

interface UpstreamTool {
  name: string
  description?: string | undefined
  inputSchema: Record<string, unknown>
}

function toToolContent(result: unknown): CallToolResult {
  if (typeof result !== 'object' || result === null) {
    return { content: [{ type: 'text', text: String(result) }] }
  }
  const record = result as { content?: unknown; isError?: unknown }
  const content = Array.isArray(record.content) ? (record.content as CallToolResult['content']) : []
  const output =
    content.length > 0
      ? content
      : ([{ type: 'text', text: '' }] as CallToolResult['content'])
  return typeof record.isError === 'boolean' && record.isError
    ? { content: output, isError: true }
    : { content: output }
}

/**
 * Build host-neutral tool registrations for one upstream server. The raw
 * schema is retained for MCP while Pi receives the TypeBox representation.
 */
export function buildToolRegistrations(
  prefix: string,
  tools: UpstreamTool[],
  callUpstream: (name: string, params: Record<string, unknown>) => Promise<unknown>
): ToolRegistration[] {
  return tools.map((tool) => {
    const name = `${prefix}${tool.name}`
    const description = tool.description?.trim()
      ? `[${prefix.replace(/_$/, '')}] ${tool.description}`
      : `[${prefix.replace(/_$/, '')}] ${tool.name}`
    return {
      name,
      label: name,
      description,
      inputSchema: tool.inputSchema,
      parameters: Type.Unsafe(tool.inputSchema),
      execute: async (_toolCallId, params) => {
        const result = await callUpstream(tool.name, params ?? {})
        return toToolContent(result)
      },
    }
  })
}

/** Prefix every tool of every connected server; names stay unique per server. */
export function buildAllRegistrations(
  connections: Array<{
    prefix: string
    tools: UpstreamTool[]
    callTool: ServerConnection['callTool']
  }>
): ToolRegistration[] {
  return connections.flatMap((connection) =>
    buildToolRegistrations(connection.prefix, connection.tools, connection.callTool)
  )
}
