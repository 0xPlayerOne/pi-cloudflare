import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { spawn } from 'node:child_process'

import {
  buildAuthorizeUrl,
  discoverAuthServer,
  exchangeCode,
  generatePkcePair,
  generateState,
  registerClient,
  type OAuthTokens,
} from './oauth.js'
import type { CloudflareServerDefinition } from './servers.js'

export interface OAuthFlowResult {
  tokens: OAuthTokens
  clientId: string
  tokenEndpoint: string
}

function waitForCallback(
  server: ReturnType<typeof createServer>,
  expectedState: string,
  timeoutMs: number
): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      server.close()
      reject(new Error('Timed out waiting for browser approval (5 minutes)'))
    }, timeoutMs)
    server.on('request', (request: IncomingMessage, response: ServerResponse) => {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1')
      response.writeHead(200, { 'Content-Type': 'text/html' })
      response.end(
        '<html><body><h1>Signed in.</h1><p>Return to your terminal; this window can be closed.</p></body></html>'
      )
      clearTimeout(timer)
      server.close()
      if (url.pathname !== '/callback') {
        reject(new Error(`Unexpected callback path: ${url.pathname}`))
        return
      }
      if (url.searchParams.get('state') !== expectedState) {
        reject(new Error('State mismatch: possible cross-site request, aborting'))
        return
      }
      const error = url.searchParams.get('error')
      if (error) {
        reject(new Error(`Authorization failed: ${error}`))
        return
      }
      const code = url.searchParams.get('code')
      if (!code) {
        reject(new Error('Authorization response had no code'))
        return
      }
      resolve(code)
    })
  })
}

function openBrowser(url: string): void {
  const opener = process.platform === 'darwin' ? 'open' : 'xdg-open'
  const child = spawn(opener, [url], { detached: true, stdio: 'ignore' })
  child.unref()
  console.log(`Opened browser for approval. If nothing opened, visit:\n  ${url}\n`)
}

/**
 * One-time browser OAuth for a single MCP server: dynamic registration,
 * PKCE, localhost callback, code exchange. Nothing secret is logged.
 */
export async function runOAuthFlow(
  definition: CloudflareServerDefinition,
  options: { timeoutMs?: number } = {}
): Promise<OAuthFlowResult> {
  const metadata = await discoverAuthServer(definition.url)
  if (!metadata.registrationEndpoint) {
    throw new Error(`${definition.id}: server does not support dynamic client registration`)
  }
  const server = createServer()
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
  const address = server.address()
  if (!address || typeof address === 'string') {
    server.close()
    throw new Error('Could not bind localhost callback')
  }
  const redirectUri = `http://127.0.0.1:${address.port}/callback`
  try {
    const { clientId } = await registerClient(metadata.registrationEndpoint, redirectUri)
    const { verifier, challenge } = generatePkcePair()
    const state = generateState()
    openBrowser(
      buildAuthorizeUrl({
        authorizationEndpoint: metadata.authorizationEndpoint,
        clientId,
        redirectUri,
        state,
        challenge,
        resource: definition.url,
      })
    )
    const code = await waitForCallback(server, state, options.timeoutMs ?? 5 * 60_000)
    const tokens = await exchangeCode({
      tokenEndpoint: metadata.tokenEndpoint,
      clientId,
      code,
      redirectUri,
      verifier,
    })
    return { tokens, clientId, tokenEndpoint: metadata.tokenEndpoint }
  } finally {
    server.close()
  }
}
