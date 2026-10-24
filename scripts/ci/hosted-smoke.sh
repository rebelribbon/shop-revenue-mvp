#!/usr/bin/env bash
# Hosted smoke check for one exact Vercel deployment (Section 24 deploy gate).
#
# Usage: scripts/ci/hosted-smoke.sh <deployment-url> <expected-commit-sha>
# Env:   VERCEL_TOKEN (required), VERCEL_CLI (default vercel@63.1.0)
#
# Preview deployments are behind Vercel Deployment Protection. Plain curl gets
# a 302 to vercel.com/login, so this goes through `vercel curl`, which sends
# the project's "Protection Bypass for Automation" secret
# (x-vercel-protection-bypass) using VERCEL_TOKEN. Protection stays enabled; if
# the project has no automation bypass secret yet, the CLI creates one (visible
# under Project Settings -> Deployment Protection). The secret never reaches
# this script's output: the CLI passes it straight to curl, and --debug (which
# would print it) is never used.
set -euo pipefail
url="${1:?deployment url}"
sha="${2:?expected commit sha}"
: "${VERCEL_TOKEN:?VERCEL_TOKEN is required}"
cli="${VERCEL_CLI:-vercel@63.1.0}"
export VERCEL_TELEMETRY_DISABLED=1

vcurl() {
  npx --yes "$cli" curl "$1" --deployment "$url" --token "$VERCEL_TOKEN" --yes -- \
    --fail --silent --show-error --max-time 20 "${@:2}"
}

body=""
for i in $(seq 1 30); do
  if body=$(vcurl /api/health 2>/dev/null) && echo "$body" | jq -e . >/dev/null 2>&1; then
    if echo "$body" | jq -e '.status == "ok" and .database.ok == true' >/dev/null; then break; fi
  fi
  if [ "$i" -eq 30 ]; then
    echo "::error::health check failed for $url (last body was $(echo "$body" | head -c 200 | tr -d '\n' | jq -Rr @json 2>/dev/null || echo 'not JSON'))"
    exit 1
  fi
  sleep 10
done

version=$(echo "$body" | jq -r '.version // empty')
if [ "$version" != "$sha" ]; then
  echo "::error::deployment $url reports version '$version', expected $sha"
  exit 1
fi
echo "health ok: $(echo "$body" | jq -c '{status, database, backgroundProcessing, version}')"

for path in /sign-in /no-access; do
  vcurl "$path" --output /dev/null
  echo "page ok: $path"
done
