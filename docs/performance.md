# Performance and release validation

The package proxies requests to Cloudflare-hosted MCP Workers; it does not deploy a Worker of its
own. The local performance boundary is therefore the extension build and startup path, the proxy
overhead added to each remote tool call, and the npm artifact installed by Pi. Remote network and
Cloudflare Worker latency are deliberately excluded because they cannot form a repeatable local or
CI regression gate.

## Repeatable audit

Run the report without enforcing budgets:

```bash
npm run perf
```

Run the same audit as a regression gate:

```bash
npm run perf:check
```

Pass `-- --json` to either command for machine-readable results. The audit runs without credentials
or network access and measures:

- TypeScript build duration.
- P95 cold import time across seven isolated Node processes.
- P95 local proxy overhead across 5,000 mocked tool requests after warmup.
- Total compiled `dist/` size.
- Packed and unpacked npm artifact size.
- Production transitive dependency count from `package-lock.json`.
- Published file count and the required/forbidden artifact layout.

Regression ceilings live in [`performance-budget.json`](../performance-budget.json). They are
intentionally above the measured M0 baseline so ordinary CI variance does not fail builds, while
material increases in startup, proxy overhead, bundle size, package size, or dependency cost require
an explicit review and budget update.

## Deployment behavior

`npm pack --dry-run --json --ignore-scripts` models the artifact handed to npm and installed by Pi.
The gate requires the setup executable, JavaScript and type entry points, and the root Cloudflare
skill. It rejects source, tests, and repository scripts. This keeps the published deployment shape
stable without publishing or contacting Cloudflare.

## Release path

1. Run `npm test`. Its `pretest` hook builds the package, the unit suite verifies the existing API
   and proxy behavior, and `perf:check` enforces the M0 budgets and artifact contract.
2. Run `npm run format:check`, `npm run lint`, and `npm run typecheck` locally.
3. Open a pull request to `main`. The Code Foundry validation workflow repeats format, lint,
   type-check, build, tests, security, and CodeQL checks; `Validation / Gate` is the stable aggregate
   merge gate.
4. Squash-merge a normal feature pull request only after the aggregate gate passes. Release Please
   then prepares the version pull request, which rebases into `main` after its release-policy
   validation passes.
5. The release workflow publishes the npm artifact. No Cloudflare deployment, credential change,
   or migration is part of this package release.

When a deliberate change exceeds a budget, attach before/after JSON reports to the pull request and
explain the user-visible benefit before raising the corresponding ceiling.
