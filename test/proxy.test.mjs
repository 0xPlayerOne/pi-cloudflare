import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { buildAllRegistrations, buildToolRegistrations } from "../dist/proxy.js";

const searchTool = {
  name: "search",
  description: "Search things",
  inputSchema: { type: "object", properties: { q: { type: "string" } } },
};

describe("proxy", () => {
  it("prefixes tool names and labels per server", () => {
    const [registration] = buildToolRegistrations("cf_api_", [searchTool], async () => ({}));
    assert.equal(registration.name, "cf_api_search");
    assert.equal(registration.label, "cf_api_search");
    assert.match(registration.description, /cf_api/);
  });

  it("keeps identical upstream names unique across servers", () => {
    const registrations = buildAllRegistrations([
      { prefix: "cf_api_", tools: [searchTool], callTool: async () => ({}) },
      { prefix: "cf_docs_", tools: [searchTool], callTool: async () => ({}) },
    ]);
    assert.deepEqual(
      registrations.map((registration) => registration.name),
      ["cf_api_search", "cf_docs_search"]
    );
  });

  it("routes execution to the owning server with the original name", async () => {
    const calls = [];
    const [registration] = buildToolRegistrations(
      "cf_docs_",
      [searchTool],
      async (name, params) => {
        calls.push([name, params]);
        return { content: [{ type: "text", text: "ok" }] };
      }
    );
    const result = await registration.execute("call-1", { q: "workers" }, undefined);
    assert.deepEqual(calls, [["search", { q: "workers" }]]);
    assert.deepEqual(result, { content: [{ type: "text", text: "ok" }] });
  });

  it("surfaces upstream errors and normalizes empty results", async () => {
    const [failing] = buildToolRegistrations("cf_api_", [searchTool], async () => ({
      content: [],
      isError: true,
    }));
    assert.deepEqual(await failing.execute("c", {}, undefined), {
      content: [{ type: "text", text: "" }],
      isError: true,
    });
    const [weird] = buildToolRegistrations("cf_api_", [searchTool], async () => "plain");
    assert.deepEqual(await weird.execute("c", {}, undefined), {
      content: [{ type: "text", text: "plain" }],
    });
  });
});
