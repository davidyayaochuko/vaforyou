#!/usr/bin/env bash
# Ask Funke on the usage-test instance without printing the token.
# Usage: scripts/usage-ask.sh "What's on my plate?"
set -euo pipefail
ENV_FILE="${USAGE_ENV:-/tmp/funke-usage-qa/.env}"
set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a
TEXT="${1:-}"
if [[ -z "$TEXT" ]]; then
  echo "usage: $0 \"message\"" >&2
  exit 2
fi
PAYLOAD=$(node -e 'process.stdout.write(JSON.stringify({ text: process.argv[1] }))' "$TEXT")
curl -sS \
  -H "Authorization: Bearer ${API_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD" \
  "http://127.0.0.1:${PORT:-4322}/api/ask"
echo
