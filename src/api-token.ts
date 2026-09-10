import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const API_TOKEN_FILE = 'cloudflare-api-token'

/**
 * Read the native Pi API-token file without evaluating it as shell code.
 * The file is written as an owner-only shell export by the token setup flow.
 */
export function readApiTokenFile(home = homedir()): string | undefined {
  try {
    const contents = readFileSync(join(home, '.pi', API_TOKEN_FILE), 'utf8')
    const match =
      /^\s*export\s+CLOUDFLARE_API_TOKEN=(?:"([^"\r\n]*)"|'([^'\r\n]*)'|([^\s#\r\n]+))\s*$/m.exec(
        contents
      )
    return match?.[1] || match?.[2] || match?.[3] || undefined
  } catch {
    return undefined
  }
}

/** Resolve static credentials in precedence order without exposing the value. */
export function resolveApiToken(
  config: { apiToken?: string } = {},
  env: { CLOUDFLARE_API_TOKEN?: string } = process.env,
  home = homedir()
): string | undefined {
  return config.apiToken?.trim() || env.CLOUDFLARE_API_TOKEN?.trim() || readApiTokenFile(home)
}
