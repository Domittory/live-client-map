#!/usr/bin/env bash
set -euo pipefail

# Post-deploy smoke check (ticket 63). Verifies the deployed app responds
# and reports readiness before a release is considered complete.
#
# Usage: ./scripts/post-deploy-smoke.sh <base-url>
#   ./scripts/post-deploy-smoke.sh https://staging.example.com

BASE_URL="${1:?usage: post-deploy-smoke.sh <base-url>}"

fail() {
  echo "SMOKE FAIL: $1" >&2
  exit 1
}

echo "==> Health check: ${BASE_URL}/api/health"
HEALTH="$(curl -fsS --max-time 20 "${BASE_URL}/api/health")" || fail "health endpoint unreachable"
echo "${HEALTH}"

echo "${HEALTH}" | grep -q '"status":"ok"' || fail "health status is not ok"
echo "${HEALTH}" | grep -q '"service":"living-client-map"' || fail "unexpected service name"

echo "==> Root page: ${BASE_URL}/"
HTTP="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 20 "${BASE_URL}/")" || fail "root page unreachable"
[ "${HTTP}" = "200" ] || fail "root page returned HTTP ${HTTP} (expected 200)"

echo "==> SMOKE OK"
