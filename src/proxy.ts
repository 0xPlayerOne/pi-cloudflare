import { Type } from 'typebox'

import type { ServerConnection } from './client.js'

export interface ToolRegistration {
  name: string
  label: string
  description: string
  parameters: unknown
  execute: (
    toolCallId: string,
    params: Record<string, unknown>,
    signal: AbortSignal | undefined
  ) => Promise<{ content: unknown[]; isError?: boolean }>
}

interface UpstreamTool {
  name: string
  description?: string | undefined
  inputSchema: Record<string, unknown>
}

function toToolContent(result: unknown): { content: unknown[]; isError?: boolean } {
  if (typeof result !== 'object' || result === null) {
    return { content: [{ type: 'text', text: String(result) }] }
  }
  const record = result as { content?: unknown; isError?: unknown }
  const content = Array.isArray(record.content) ? record.content : []
  const output = content.length > 0 ? content : [{ type: 'text', text: '' }]
  return typeof record.isError === 'boolean' && record.isError
    ? { content: output, isError: true }
    : { content: output }
}

/**
 * Build pi tool registrations for one upstream server. Pure function over
 * injected dependencies so it unit tests without network or a pi session.
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
