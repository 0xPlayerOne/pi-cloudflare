#!/usr/bin/env bash
# Refresh the vendored Cloudflare skills from upstream.
# Usage: scripts/sync-skills.sh [checkout-dir]
# Intentionally excludes web-perf: downstream users keep their own
# operational customization of that skill (see README).
set -euo pipefail

SKILLS="agents-sdk cloudflare cloudflare-email-service cloudflare-one cloudflare-one-migrations durable-objects sandbox-migrate-to-next sandbox-next sandbox-stable turnstile-spin workers-best-practices wrangler"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="${1:-}"

if [ -z "$SRC" ]; then
  SRC="$(mktemp -d)/skills"
  git clone --depth 1 https://github.com/cloudflare/skills "$SRC/repo" >&2
  SRC="$SRC/repo/skills"
  CLEANUP=1
else
  CLEANUP=0
fi

for skill in $SKILLS; do
  if [ ! -d "$SRC/$skill" ]; then
    echo "missing upstream skill: $skill" >&2
    exit 1
  fi
  rm -rf "$ROOT/skills/$skill"
  cp -r "$SRC/$skill" "$ROOT/skills/$skill"
  echo "synced $skill"
done

if [ "$CLEANUP" = 1 ]; then
  rm -rf "$(dirname "$SRC")"
fi
