import { randomBytes, createHash } from 'node:crypto'

export interface OAuthServerMetadata {
  issuer: string
  authorizationEndpoint: string
  tokenEndpoint: string
  registrationEndpoint?: string
}

export interface RegisteredClient {
  clientId: string
  tokenEndpoint: string
}

export interface OAuthTokens {
  accessToken: string
  refreshToken?: string
  expiresAt: number
}

function base64Url(bytes: Uint8Array | Buffer): string {
  return Buffer.from(bytes)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

export function pkceChallengeFor(verifier: string): string {
  return base64Url(createHash('sha256').update(verifier).digest())
}

export function generatePkcePair(): { verifier: string; challenge: string } {
  const verifier = base64Url(randomBytes(32))
  return { verifier, challenge: pkceChallengeFor(verifier) }
}

export function generateState(): string {
  return base64Url(randomBytes(16))
}

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url, { headers: { Accept: 'application/json' } })
  if (!response.ok) {
    throw new Error(`GET ${url} failed with ${response.status}`)
  }
  return response.json()
}

export async function discoverAuthServer(mcpUrl: string): Promise<OAuthServerMetadata> {
  const challenge = await fetch(mcpUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }),
  })
  if (challenge.status !== 401) {
    throw new Error(`Expected 401 auth challenge from ${mcpUrl}, got ${challenge.status}`)
  }
  const wwwAuth = challenge.headers.get('www-authenticate') ?? ''
  const metadataUrl = /resource_metadata="([^"]+)"/.exec(wwwAuth)?.[1]
  if (!metadataUrl) throw new Error(`No resource metadata advertised by ${mcpUrl}`)
  const resource = (await fetchJson(metadataUrl)) as {
    resource?: string
    authorization_servers?: string[]
  }
  const issuer = resource.authorization_servers?.[0]
  if (!issuer) throw new Error(`No authorization server advertised by ${mcpUrl}`)
  const metadata = (await fetchJson(
    `${issuer.replace(/\/$/, '')}/.well-known/oauth-authorization-server`
  )) as {
    issuer?: string
    authorization_endpoint?: string
    token_endpoint?: string
    registration_endpoint?: string
  }
  if (!metadata.authorization_endpoint || !metadata.token_endpoint) {
    throw new Error(`Incomplete OAuth metadata from ${issuer}`)
  }
  return {
    issuer,
    authorizationEndpoint: metadata.authorization_endpoint,
    tokenEndpoint: metadata.token_endpoint,
    registrationEndpoint: metadata.registration_endpoint,
  }
}

export async function registerClient(
  registrationEndpoint: string,
  redirectUri: string
): Promise<RegisteredClient> {
  const response = await fetch(registrationEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      redirect_uris: [redirectUri],
      grant_types: ['authorization_code', 'refresh_token'],
      token_endpoint_auth_method: 'none',
      client_name: 'pi-cloudflare',
    }),
  })
  if (!response.ok) {
    throw new Error(`Client registration failed with ${response.status}`)
  }
  const body = (await response.json()) as { client_id?: string }
  if (!body.client_id) throw new Error('Registration response had no client_id')
  return { clientId: body.client_id, tokenEndpoint: registrationEndpoint }
}

export function buildAuthorizeUrl(options: {
  authorizationEndpoint: string
  clientId: string
  redirectUri: string
  state: string
  challenge: string
  resource: string
  scope?: string
}): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: options.clientId,
    redirect_uri: options.redirectUri,
    code_challenge: options.challenge,
    code_challenge_method: 'S256',
    state: options.state,
    resource: options.resource,
  })
  if (options.scope) params.set('scope', options.scope)
  return `${options.authorizationEndpoint}?${params.toString()}`
}

export async function exchangeCode(options: {
  tokenEndpoint: string
  clientId: string
  code: string
  redirectUri: string
  verifier: string
}): Promise<OAuthTokens> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: options.clientId,
    code: options.code,
    redirect_uri: options.redirectUri,
    code_verifier: options.verifier,
  })
  const response = await fetch(options.tokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })
  if (!response.ok) {
    throw new Error(`Token exchange failed with ${response.status}`)
  }
  return readTokens(await response.json())
}

export async function refreshAccessToken(options: {
  tokenEndpoint: string
  clientId: string
  refreshToken: string
}): Promise<OAuthTokens> {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: options.clientId,
    refresh_token: options.refreshToken,
  })
  const response = await fetch(options.tokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })
  if (!response.ok) {
    throw new Error(`Token refresh failed with ${response.status}`)
  }
  const tokens = readTokens(await response.json())
  return {
    ...tokens,
    refreshToken: tokens.refreshToken ?? options.refreshToken,
  }
}

function readTokens(body: unknown): OAuthTokens {
  const record = body as { access_token?: unknown; refresh_token?: unknown; expires_in?: unknown }
  if (typeof record.access_token !== 'string' || !record.access_token) {
    throw new Error('Token response had no access_token')
  }
  const lifetime = typeof record.expires_in === 'number' ? record.expires_in : 3600
  return {
    accessToken: record.access_token,
    refreshToken: typeof record.refresh_token === 'string' ? record.refresh_token : undefined,
    expiresAt: Date.now() + Math.max(lifetime - 60, 0) * 1000,
  }
}
