# API reference

Verified calls for each change the hardening skill makes. All paths are relative
to `https://api.cloudflare.com/client/v4`. Send
`Authorization: Bearer $CLOUDFLARE_API_TOKEN` and
`Content-Type: application/json`.

Read the current value before writing, and re-read after — see the silent-no-op
table in `SKILL.md`.

## Discovery

```bash
GET /accounts?per_page=50
GET /zones?per_page=50
GET /zones/:zone_id/settings
GET /zones/:zone_id/dns_records?per_page=100
```

`GET /zones` returns each zone's `account`, `plan`, and `status`, so the whole
estate can be walked from these four calls.

To learn whether a hostname is proxied, look for the `cf-ray` response header on
a live request rather than trusting the DNS record alone.

## Zone settings

```bash
PATCH /zones/:zone_id/settings/:setting_id
{ "value": <value> }
```

| Setting | Value | Notes |
| --- | --- | --- |
| `min_tls_version` | `"1.2"` | |
| `always_use_https` | `"on"` | |
| `automatic_https_rewrites` | `"on"` | |
| `tls_1_3` | `"zrt"` | |
| `0rtt` | `"on"` | |
| `early_hints` | `"on"` | |
| `brotli` | `"on"` | |
| `security_level` | `"medium"` | Raise only during an attack |

HSTS is a nested object:

```jsonc
PATCH /zones/:zone_id/settings/security_header
{
  "value": {
    "strict_transport_security": {
      "enabled": true,
      "max_age": 15552000,          // 180 days
      "include_subdomains": true,   // only if every subdomain is HTTPS-capable
      "preload": false,             // effectively irreversible; leave false
      "nosniff": true
    }
  }
}
```

Some settings are read-only on a given plan and arrive with `"editable": false`.
Check that field before attempting a write; the PATCH will not tell you.

## Bot management

The AI-bot and fight-mode fields live here, not under `/settings`. Use `PUT` —
`PATCH` answers `405 10405`.

Send **only the fields being changed**. Echoing the whole object back fails with
`400 Bad Request`, because the write rejects computed and read-only fields
(`is_robots_txt_managed`, `using_latest_model`, and friends). Every other
setting is preserved on its own, so a partial body is correct rather than risky.

```jsonc
// read first to see what is on
GET /zones/:zone_id/bot_management

PUT /zones/:zone_id/bot_management
{ "ai_bots_protection": "block" }   // disabled | only_on_ad_pages | block
```

### JavaScript Detections and Bot Fight Mode inject a script

Two fields on the same object add JavaScript to **every HTML response**:

| Field | Dashboard toggle | Effect |
| --- | --- | --- |
| `enable_js` | Security → Bots → JavaScript Detections | Injects `/cdn-cgi/challenge-platform/scripts/jsd/main.js` |
| `fight_mode` | Security → Bots → Bot Fight Mode | Adds edge protection; also drives the injected detection script |

The injected script trips Lighthouse Best Practices **"Avoid deprecated APIs"**
and costs roughly 40 Best-Practices points on a fast site, so treat `enable_js:
true` as a performance finding rather than a security win. Turning both off is a
tradeoff, not a free fix — it also removes edge bot protection, so say so in the
report.

```jsonc
PUT /zones/:zone_id/bot_management
{ "enable_js": false, "fight_mode": false }
```

`ai_bots_protection: "block"` is the compromise: it blocks AI scrapers at the
edge, injects no script, and costs nothing. Prefer it when the user wants bot
protection without the performance hit.

## Workers

Inventory scripts, then check each one's settings:

```bash
GET /accounts/:account_id/workers/scripts
GET /accounts/:account_id/workers/scripts/:script/settings
```

Three things to check per script:

- **`observability.enabled`** — free, and off by default in some deploy paths.
  Workers with it off produce no logs when something breaks, so treat an estate
  with mixed states as a gap and align it.
- **`compatibility_date`** — anything more than a few months old is worth
  flagging; stale dates silently gate new runtime behaviour.
- **`bindings`** — confirm the script has what it needs and nothing orphaned.

Two traps on this endpoint:

- **`PATCH` requires `multipart/form-data`, not JSON.** A JSON body fails with
  `Content-Type must be one of: multipart/form-data`. Send the settings as a
  `settings` part:

  ```js
  const fd = new FormData()
  fd.append('settings', new Blob([JSON.stringify({
    observability: { enabled: true, head_sampling_rate: 1 },
  })], { type: 'application/json' }))
  fetch(`.../workers/scripts/:script/settings`, { method: 'PATCH', headers, body: fd })
  ```

- **`GET /accounts/:id/workers/domains` ignores the `worker_name` filter** and
  returns every custom domain on the account. Do not conclude that several
  workers share one hostname from that response — map hostnames by the `service`
  field, or query without a filter and group client-side.

Custom-domain mapping (the clean way):

```bash
GET /accounts/:account_id/workers/domains
# each entry: { hostname, service } — service is the worker name
```

A preview worker should have **no** custom domain; if it does, that is worth
reporting. Preview URLs should sit behind an Access app.

## Free managed WAF ruleset

The managed ruleset object **already exists** on every zone but is not applied —
there is no entrypoint until a rule executes it. A zone with no entrypoint has no
managed WAF coverage at all.

```bash
# 1. find the managed ruleset id for this zone
GET /zones/:zone_id/rulesets
# → look for phase "http_request_firewall_managed"

# 2. apply it
PUT /zones/:zone_id/rulesets/phases/http_request_firewall_managed/entrypoint
{
  "rules": [
    {
      "action": "execute",
      "description": "Deploy Cloudflare Free Managed Ruleset",
      "enabled": true,
      "expression": "true",
      "action_parameters": { "id": "<managed ruleset id>" }
    }
  ]
}
```

Coverage is a fixed set of CVE signatures (Log4j, Shellshock, common WordPress
plugin and injection families) — not a general-purpose WAF. Verified behaviour:

| Probe | Result |
| --- | --- |
| `${jndi:…}` in a request **header** | `403` — blocked |
| Shellshock payload in `User-Agent` | `403` — blocked |
| `${jndi:…}` in the **URI path** | `307`/`308` — NOT blocked (those are path-normalization redirects) |
| SQLi / XSS payloads | Not covered |

Do not read a non-`403` on a URI payload as a broken deployment.

Read the ruleset with `GET /zones/:zone_id/rulesets/:ruleset_id` to inspect the
signature list on the user's plan.

## Response header transform rules

Preserve any rules already in the phase — read the entrypoint first, then PUT the
merged list. Strip server-assigned fields (`id`, `version`, `last_updated`,
`ref`) from rules you read back.

```jsonc
PUT /zones/:zone_id/rulesets/phases/http_response_headers_transform/entrypoint
{
  "rules": [
    {
      "action": "rewrite",
      "description": "Baseline security headers",
      "enabled": true,
      "expression": "true",
      "action_parameters": {
        "headers": {
          "x-content-type-options": { "operation": "set", "value": "nosniff" },
          "referrer-policy": { "operation": "set", "value": "strict-origin-when-cross-origin" },
          "x-frame-options": { "operation": "set", "value": "SAMEORIGIN" },
          "permissions-policy": { "operation": "set", "value": "camera=(), microphone=(), geolocation=()" }
        }
      }
    }
  ]
}
```

Only add headers the live response is missing — an origin that already sets one
should keep its own value. Use `operation: "add"` for genuinely multi-value
headers so origin values are preserved.

Expression operators are plan-gated: `matches` (regex) needs Business or WAF
Advanced, while `in`, `eq`, `starts_with`, `extension`, `len`, and `substring`
work on Free. Match on file extension rather than hash-shaped paths.

A missing entrypoint answers `404` with error code `10003
could not find entrypoint ruleset in the <phase> phase` — which confirms the
permission is present, so treat it as "nothing configured yet", not a failure.

## Compression rules

Cloudflare's built-in compression covers js/css/json/svg/wasm but omits several
binary types that compress well:

```jsonc
PUT /zones/:zone_id/rulesets/phases/http_response_compression/entrypoint
{
  "rules": [
    {
      "action": "compress_response",
      "description": "Compress model and font assets",
      "enabled": true,
      "expression": "(http.request.uri.path.extension in {\"glb\" \"gltf\" \"bin\" \"woff\" \"woff2\" \"ttf\"})",
      "action_parameters": {
        "algorithms": [{ "name": "brotli" }, { "name": "gzip" }]
      }
    }
  ]
}
```

Confirm the payload actually shrinks by requesting the asset with and without
`Accept-Encoding: br` and comparing `content-encoding` / `content-length`.

## DNSSEC

```bash
GET /zones/:zone_id/dnssec     # status: disabled | pending | active
PATCH /zones/:zone_id/dnssec   # documented path
{ "status": "active" }
```

`PUT` with an explicit `{"status":"active"}` body also works. Empty-body `PATCH`
and empty-body `PUT` both return `200` without enabling anything — re-read to
confirm the zone reached `pending`.

Enabling is safe and inert: resolution is unaffected until the registrar
publishes the DS. Check the parent first:

```bash
dig +short DS <zone>      # empty means no DS is published
```

The response carries the record to hand the user:

```
<zone>. 3600 IN DS <key_tag> <algorithm> <digest_type> <digest>
```

**There is no API to publish the DS** — and this matters more than it looks,
because it splits by registrar:

- **Domain registered with Cloudflare Registrar:** the dashboard's
  **Enable DNSSEC** button publishes the DS to the registry automatically
  ("one-click DNSSEC"). An API enablement does **not** trigger that registrar
  sync, so a zone enabled over the API can sit at `pending` for days even though
  everything else is correct. The fix is a dashboard visit: toggle DNSSEC off and
  back on in **DNS → Settings**, which re-runs the flow that publishes the DS.

  Verified live: after the off/on cycle, the DS appeared at the registry within
  minutes and the zone began validating (the `ad` flag appeared on resolver
  responses). Publication lands progressively per TLD — two Google-registry TLDs
  published within ~15 minutes, others queued longer. The zone reads `pending`
  the whole time, so the registry, not the API, is the only source of truth.

  The cycle through the browser is: **Cancel Setup** → confirm the
  **Disable DNSSEC** dialog → wait for status `disabled` → **Enable DNSSEC** →
  confirm → wait for `pending`. Note the confirmation dialog is role
  `alertdialog`, and the disable is asynchronous — it reached `disabled` on the
  first poll in every case.
- **Domain registered elsewhere:** add the DS record at that registrar. The zone
  publishes CDS/CDNSKEY, so a registrar that supports RFC 8078 can pick it up
  automatically.

Either way the API cannot do the last step: the new
`/accounts/:id/registrar/registrations/:domain` update endpoint documents
"currently supports updating `auto_renew` only", `?include=dnssec` is accepted
and returns nothing, and the dashboard serves a bot challenge to headless
browsers. Do not promise the user a fully automated DNSSEC rollout.

Confirm the outcome from outside rather than from the API — the zone will read
`active` or `pending` regardless, so the registry is the source of truth:

```bash
dig +dnssec <zone> @1.1.1.1 | grep -o "ad"   # ad flag = validating end to end
```

## Turnstile

```bash
GET  /accounts/:account_id/challenges/widgets
POST /accounts/:account_id/challenges/widgets
{ "name": "<name>", "domains": ["<zone>"], "mode": "managed" }
# → result.sitekey and result.secret — the secret is shown ONCE
```

The secret is never returned again. Store it immediately, ideally in the
account's Secrets Store:

```bash
GET /accounts/:account_id/secrets_store/stores
# reuse an existing store if one exists — the Free plan allows only one

POST /accounts/:account_id/secrets_store/stores/:store_id/secrets
# body is an ARRAY; a bare object fails with 1001 invalid_json_body
[
  { "name": "TURNSTILE_SITEKEY", "value": "<sitekey>", "scopes": ["workers"] },
  { "name": "TURNSTILE_SECRET",  "value": "<secret>",  "scopes": ["workers"] }
]
```

Stored values are write-only on read-back, so capture them from the create
response. `GET /accounts/:account_id/secrets_store/quota` shows usage.

## Registrar

Read-only in practice:

```bash
GET /accounts/:account_id/registrar/domains?per_page=100
GET /accounts/:account_id/registrar/domains/:domain
```

The `ds_records` array shows what is published at the registry (`[]` when
nothing is). `PUT` accepts only `auto_renew`, `locked`, and `privacy`.

## Verification probes

```bash
# security headers, cache directives, proxy status
curl -sI https://<zone>/ | grep -iE "^(strict-transport-security|referrer-policy|x-content-type-options|cf-ray|cache-control)"

# compression
curl -sI -H "Accept-Encoding: br" https://<zone>/<asset> | grep -iE "^(content-encoding|content-length)"

# WAF (expect 403 once the managed ruleset is applied)
curl -s -o /dev/null -w '%{http_code}\n' -H 'User-Agent: () { :;}; /bin/bash -c "echo pwned"' https://<zone>/

# resolution and DNSSEC health
dig +short A <zone> @1.1.1.1
dig <zone> @8.8.8.8 | grep -oE "status: [A-Z]+"   # NOERROR = healthy; SERVFAIL = broken
```

Responses can be cached briefly after a change — re-probe with a cache-busting
query string before concluding a write failed.
