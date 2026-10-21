#!/usr/bin/env bash
# POST JSON to usage-test API. Usage: scripts/usage-post.sh /api/conversations/new '{}'
set -euo pipefail
ENV_FILE="${USAGE_ENV:-/tmp/funke-usage-qa/.env}"
set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a
PATH_Q="${1:-}"
BODY="${2-}"
if [[ -z "$BODY" ]]; then BODY='{}'; fi
curl -sS \
  -H "Authorization: Bearer ${API_TOKEN}" \
  -H "Content-Type: application/json" \
  --data-binary "$BODY" \
  "http://127.0.0.1:${PORT:-4322}${PATH_Q}"
echo
