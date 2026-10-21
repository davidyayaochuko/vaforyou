#!/usr/bin/env bash
# GET a usage-test API path. Usage: scripts/usage-get.sh /api/approvals
set -euo pipefail
ENV_FILE="${USAGE_ENV:-/tmp/funke-usage-qa/.env}"
set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a
PATH_Q="${1:-/api/va/status}"
curl -sS -H "Authorization: Bearer ${API_TOKEN}" "http://127.0.0.1:${PORT:-4322}${PATH_Q}"
echo
