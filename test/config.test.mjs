import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { resolveConfig } from "../dist/config.js";
import { CLOUDFLARE_SERVERS } from "../dist/servers.js";

describe("config", () => {
  it("enables all five servers by default", () => {
    const resolved = resolveConfig(undefined, {});
    assert.deepEqual(
      resolved.enabledServerIds,
      CLOUDFLARE_SERVERS.map((server) => server.id)
    );
  });

  it("honors per-server disable flags", () => {
    const resolved = resolveConfig({ servers: { docs: false, builds: false } }, {});
    assert.deepEqual(resolved.enabledServerIds, ["api", "bindings", "observability"]);
  });

  it("applies a connect timeout override", () => {
    assert.equal(resolveConfig({ connectTimeoutMs: 5000 }).connectTimeoutMs, 5000);
    assert.equal(resolveConfig(undefined).connectTimeoutMs, 30000);
  });
});
