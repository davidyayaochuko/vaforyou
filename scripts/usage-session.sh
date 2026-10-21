#!/usr/bin/env bash
# Serialize persona access to the shared usage Funke (macOS-safe mkdir lock).
# Usage:
#   scripts/usage-session.sh A1 new
#   scripts/usage-session.sh A1 ask "hello"
#   scripts/usage-session.sh A1 get /api/approvals
#   scripts/usage-session.sh A1 post /api/approvals/decide '{"id":1,"decision":"approved"}'
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PERSONA="${1:?persona id}"
CMD="${2:?cmd}"
shift 2
LOCKDIR=/tmp/funke-usage.lock.d
deadline=$((SECONDS + 180))
while ! mkdir "$LOCKDIR" 2>/dev/null; do
  if (( SECONDS >= deadline )); then
    echo "lock timeout for $PERSONA" >&2
    exit 1
  fi
  sleep 0.15
done
echo "$PERSONA" > "$LOCKDIR/holder" 2>/dev/null || true
cleanup() { rmdir "$LOCKDIR" 2>/dev/null || rm -rf "$LOCKDIR"; }
trap cleanup EXIT
case "$CMD" in
  new) "$ROOT/scripts/usage-post.sh" /api/conversations/new ;;
  ask) "$ROOT/scripts/usage-ask.sh" "$*" ;;
  get) "$ROOT/scripts/usage-get.sh" "${1:?path}" ;;
  post) "$ROOT/scripts/usage-post.sh" "${1:?path}" "${2:-{}}" ;;
  *) echo "unknown cmd $CMD" >&2; exit 2 ;;
esac
