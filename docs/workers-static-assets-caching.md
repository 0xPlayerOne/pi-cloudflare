# Changing cache headers on Workers Static Assets

Established 2026-09-11 while deploying a Vite SPA to Workers Static Assets (the
`nifty-world` world app) on the `niftyworld.gg` zone, free plan.

## The constraint

Workers Static Assets always serves assets with
`cache-control: public, max-age=0, must-revalidate`. Browsers therefore
revalidate every bundle on every visit. ETags make that a `304` rather than a
re-download, so no bytes are wasted — but it still costs a round trip per
resource (a scene load fetched ~88 resources).

## What does not work (each verified empirically, not assumed)

- **`_headers` files are ignored.** A `_headers` file with
  `Cache-Control: public, max-age=12345` was deployed, and a
  never-before-requested path still returned `max-age=0`. Only Cloudflare Pages
  honors `_headers`; Workers Static Assets does not.
- **Zone Cache Rules do not apply to Worker-served assets.** A ruleset in
  `http_request_cache_settings` with `browser_ttl: override_origin` was applied,
  verified enabled via the API, and a first-ever request for a brand-new asset
  path still returned `max-age=0`. The ruleset was removed rather than left in
  place looking functional.
- **The Worker cannot set them**, if `/assets/*` is deliberately outside
  `run_worker_first` (the usual choice, to keep asset traffic off Workers
  invocation limits).

## The trap that misleads diagnosis

`cf-cache-status` on these responses reflects the **Workers asset store, not the
zone CDN cache**. It reports `HIT` even for paths that have never existed, so it
looks like edge caching is working and only the browser TTL is off. Do not use
it to judge whether a zone cache rule applied.

## What works

A **Response Header Transform Rule** in `http_response_headers_transform`
(zone-level, no Worker invocations), for example:

```jsonc
// PUT /zones/{zone_id}/rulesets/phases/http_response_headers_transform/entrypoint
{
  "rules": [
    {
      "description": "Immutable caching for content-hashed bundles",
      "expression": "(http.request.uri.path.extension in {\"js\" \"css\" \"wasm\"})",
      "action": "rewrite",
      "action_parameters": {
        "headers": {
          "cache-control": {
            "operation": "set",
            "value": "public, max-age=31536000, immutable",
          },
        },
      },
    },
  ],
}
```

Requires **Zone → Transform Rules → Edit**. Note the expression operators are
plan-gated: `matches` (regex) needs Business/WAF Advanced, while `in`, `eq`, and
`starts_with` are available on Free. Match on file **extension** rather than a
`/assets/*-????????.js` hash pattern, and check whether any un-hashed files
share the extension before granting a year — a vendored `basis/*.js` would be
pinned for a year alongside the hashed bundles.

Route HTML/API around the cache with an explicit bypass if the zone fronts the
worker domain directly.
