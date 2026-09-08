import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
  type Tool,
} from '@modelcontextprotocol/sdk/types.js'

import type { PiCloudflareConfig } from './config.js'
import type { ToolRegistration } from './proxy.js'
import { CloudflareRuntime } from './runtime.js'
import { tokenFilePath } from './token-store.js'

function packageVersion(): string {
  try {
    const raw = readFileSync(new URL('../package.json', import.meta.url), 'utf8')
    const parsed = JSON.parse(raw) as { version?: unknown }
    return typeof parsed.version === 'string' ? parsed.version : '0.0.0'
  } catch {
    return '0.0.0'
  }
}

function positiveInteger(value: string | undefined): number | undefined {
  if (!value) return undefined
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined
}

function runtimeConfig(): PiCloudflareConfig {
  const timeout = positiveInteger(process.env.PI_CLOUDFLARE_CONNECT_TIMEOUT_MS)
  return {
    apiToken: process.env.CLOUDFLARE_API_TOKEN,
    connectTimeoutMs: timeout,
  }
}

function portableTokenFile(): string {
  if (process.env.PI_CLOUDFLARE_TOKEN_FILE) return process.env.PI_CLOUDFLARE_TOKEN_FILE
  if (process.env.PLUGIN_DATA) return join(process.env.PLUGIN_DATA, 'cloudflare-tokens.json')
  return tokenFilePath()
}

function portableSetupScript(): string | undefined {
  const root = process.env.PI_CLOUDFLARE_PLUGIN_ROOT ?? process.env.PLUGIN_ROOT
  return root ? join(root, 'bin', 'setup.mjs') : undefined
}

async function main(): Promise<void> {
  const runtime = new CloudflareRuntime({
    config: runtimeConfig(),
    tokenFile: portableTokenFile(),
    setupScript: portableSetupScript(),
    warn: (message) => console.error(`[pi-cloudflare] ${message}`),
  })
  let registrationsPromise: Promise<ToolRegistration[]> | undefined
  const registrations = () => {
    registrationsPromise ??= runtime.start()
    return registrationsPromise
  }

  const server = new Server(
    { name: 'pi-cloudflare', version: packageVersion() },
    { capabilities: { tools: {} } }
  )

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const tools = await registrations()
    return {
      tools: tools.map((tool): Tool => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema as Tool['inputSchema'],
      })),
    }
  })

  server.setRequestHandler(CallToolRequestSchema, async (request): Promise<CallToolResult> => {
    const tools = await registrations()
    const tool = tools.find((candidate) => candidate.name === request.params.name)
    if (!tool) {
      return {
        content: [{ type: 'text', text: `Unknown tool: ${request.params.name}` }],
        isError: true,
      }
    }
    try {
      return await tool.execute('agent-plugin', request.params.arguments ?? {}, undefined)
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: error instanceof Error ? error.message : String(error),
          },
        ],
        isError: true,
      }
    }
  })

  const transport = new StdioServerTransport()
  await server.connect(transport)

  const shutdown = async () => {
    await runtime.stop()
    await server.close()
  }
  process.once('SIGINT', () => {
    void shutdown().finally(() => process.exit(0))
  })
  process.once('SIGTERM', () => {
    void shutdown().finally(() => process.exit(0))
  })
}

main().catch((error) => {
  console.error(
    `[pi-cloudflare] MCP server failed: ${error instanceof Error ? error.message : String(error)}`
  )
  process.exitCode = 1
})
