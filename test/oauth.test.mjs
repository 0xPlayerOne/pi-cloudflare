import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  buildAuthorizeUrl,
  generatePkcePair,
  generateState,
  pkceChallengeFor,
} from "../dist/oauth.js";

describe("oauth", () => {
  it("derives the RFC 7636 PKCE challenge vector", () => {
    assert.equal(
      pkceChallengeFor("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
      "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
    );
  });

  it("generates matching verifier/challenge pairs and unique states", () => {
    const pair = generatePkcePair();
    assert.equal(pkceChallengeFor(pair.verifier), pair.challenge);
    assert.match(pair.verifier, /^[A-Za-z0-9_-]+$/);
    assert.notEqual(generateState(), generateState());
  });

  it("builds an authorize URL with PKCE, state, and resource", () => {
    const url = new URL(
      buildAuthorizeUrl({
        authorizationEndpoint: "https://mcp.example.com/authorize",
        clientId: "client-1",
        redirectUri: "http://127.0.0.1:54321/callback",
        state: "state-1",
        challenge: "challenge-1",
        resource: "https://mcp.example.com/mcp",
      })
    );
    assert.equal(url.searchParams.get("response_type"), "code");
    assert.equal(url.searchParams.get("client_id"), "client-1");
    assert.equal(url.searchParams.get("code_challenge_method"), "S256");
    assert.equal(url.searchParams.get("code_challenge"), "challenge-1");
    assert.equal(url.searchParams.get("state"), "state-1");
    assert.equal(url.searchParams.get("resource"), "https://mcp.example.com/mcp");
  });
});
