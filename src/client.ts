import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { Tool } from '@modelcontextprotocol/sdk/types.js'

import type { CloudflareServerDefinition } from './servers.js'

export interface ServerConnection {
  definition: CloudflareServerDefinition
  listTools: () => Promise<Tool[]>
  callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>
  close: () => Promise<void>
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
  })
  return Promise.race([promise.finally(() => clearTimeout(timer)), timeout])
}

export async function connectServer(
  definition: CloudflareServerDefinition,
  options: { apiToken?: string | undefined; timeoutMs: number }
): Promise<ServerConnection> {
  const headers: Record<string, string> = {}
  if (options.apiToken) headers['Authorization'] = `Bearer ${options.apiToken}`
  const transport = new StreamableHTTPClientTransport(new URL(definition.url), {
    requestInit: { headers },
  })
  const client = new Client({ name: 'pi-cloudflare', version: '0.1.0' }, { capabilities: {} })
  const timeoutMs = options.timeoutMs
  await withTimeout(client.connect(transport), timeoutMs, `connect ${definition.id}`)
  return {
    definition,
    listTools: async () => {
      const result = await withTimeout(client.listTools(), timeoutMs, `listTools ${definition.id}`)
      return result.tools
    },
    callTool: async (name, args) => {
      return withTimeout(
        client.callTool({ name, arguments: args }),
        timeoutMs,
        `callTool ${definition.id}.${name}`
      )
    },
    close: async () => {
      await client.close().catch(() => undefined)
    },
  }
}

/** Connect every enabled server independently; failures isolate per server. */
export async function connectAll(
  definitions: readonly CloudflareServerDefinition[],
  options: { apiToken?: string | undefined; timeoutMs: number },
  onError?: (id: string, error: unknown) => void
): Promise<ServerConnection[]> {
  const settled = await Promise.all(
    definitions.map(async (definition) => {
      try {
        return await connectServer(definition, options)
      } catch (error) {
        onError?.(definition.id, error)
        return undefined
      }
    })
  )
  return settled.filter((connection): connection is ServerConnection => Boolean(connection))
}
