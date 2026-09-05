import { homedir } from "node:os";
import { join } from "node:path";
import { readFileSync } from "node:fs";

import { connectServer, type ServerConnection } from "./client.js";
import { refreshAccessToken } from "./oauth.js";
import { resolveConfig, type PiCloudflareConfig } from "./config.js";
import { buildAllRegistrations, type ToolRegistration } from "./proxy.js";
import { CLOUDFLARE_SERVERS, type CloudflareServerDefinition } from "./servers.js";
import {
  isExpired,
  readTokenFile,
  writeTokenFile,
  type StoredServerTokens,
} from "./token-store.js";

interface PiToolDefinition {
  name: string;
  label?: string;
  description?: string;
  parameters?: unknown;
  execute: (
    toolCallId: string,
    params: Record<string, unknown>,
    signal?: AbortSignal
  ) => Promise<unknown>;
}

interface PiHost {
  registerTool: (definition: PiToolDefinition) => void;
  on: (event: "session_start" | "session_shutdown", handler: (...args: never[]) => unknown) => void;
}

interface PiSettingsFile {
  "pi-cloudflare"?: PiCloudflareConfig;
}

interface ServerEntry {
  definition: CloudflareServerDefinition;
  connection?: ServerConnection;
  stored?: StoredServerTokens;
}

function loadUserConfig(): PiCloudflareConfig | undefined {
  try {
    const raw = readFileSync(join(homedir(), ".pi", "agent", "settings.json"), "utf8");
    const parsed = JSON.parse(raw) as PiSettingsFile;
    return parsed["pi-cloudflare"];
  } catch {
    return undefined;
  }
}

function warn(message: string): void {
  console.warn(`[pi-cloudflare] ${message}`);
}

/** Refresh an OAuth token that is expired (or nearly so), persisting the result. */
async function ensureFreshToken(entry: ServerEntry): Promise<string | undefined> {
  const stored = entry.stored;
  if (!stored) return undefined;
  if (!isExpired(stored) || !stored.refreshToken) return stored.accessToken;
  const fresh = await refreshAccessToken({
    tokenEndpoint: stored.tokenEndpoint,
    clientId: stored.clientId,
    refreshToken: stored.refreshToken,
  });
  entry.stored = { ...stored, ...fresh };
  const file = readTokenFile() ?? { version: 1 as const, servers: {} };
  file.servers[entry.definition.id] = entry.stored;
  writeTokenFile(file.servers);
  await entry.connection?.close().catch(() => undefined);
  entry.connection = await connectServer(entry.definition, {
    apiToken: entry.stored.accessToken,
    timeoutMs: 30_000,
  });
  return entry.stored.accessToken;
}

/**
 * pi-coding-agent extension entry point.
 *
 * Credentials come only from per-server browser OAuth (pi-cloudflare-setup
 * --oauth), stored owner-only in ~/.pi/cloudflare-tokens.json. The docs
 * server needs no credential. On session_start every enabled server is
 * connected independently and its tools registered with a `cf_<server>_`
 * prefix; unreachable servers are skipped with a re-auth hint instead of
 * failing the session. On session_shutdown all connections close.
 */
export default function piCloudflareExtension(pi: PiHost): void {
  let entries: ServerEntry[] = [];

  pi.on("session_start", async () => {
    for (const entry of entries) {
      await entry.connection?.close().catch(() => undefined);
    }
    entries = [];
    const config = resolveConfig(loadUserConfig());
    const file = readTokenFile();
    const definitions = CLOUDFLARE_SERVERS.filter((server) =>
      config.enabledServerIds.includes(server.id)
    );
    for (const definition of definitions) {
      const entry: ServerEntry = { definition };
      try {
        entry.stored = file?.servers[definition.id];
        await ensureFreshToken(entry);
        entry.connection = await connectServer(definition, {
          apiToken: entry.stored?.accessToken,
          timeoutMs: config.connectTimeoutMs,
        });
        const tools = await entry.connection.listTools();
        const registrations: ToolRegistration[] = buildAllRegistrations([
          {
            prefix: definition.prefix,
            tools,
            callTool: async (name, params) => {
              if (!entry.connection) throw new Error(`${definition.id}: not connected`);
              return entry.connection.callTool(name, params);
            },
          },
        ]);
        for (const registration of registrations) {
          pi.registerTool({
            ...registration,
            execute: async (toolCallId, params, signal) => {
              await ensureFreshToken(entry);
              return registration.execute(toolCallId, params, signal);
            },
          });
        }
        entries.push(entry);
      } catch (error) {
        warn(
          `${definition.id}: unavailable (${error instanceof Error ? error.message : String(error)}). Re-run pi-cloudflare-setup --oauth to re-authenticate.`
        );
        await entry.connection?.close().catch(() => undefined);
      }
    }
  });

  pi.on("session_shutdown", async () => {
    await Promise.all(entries.map((entry) => entry.connection?.close().catch(() => undefined)));
    entries = [];
  });
}
