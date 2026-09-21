#!/usr/bin/env bash
#
# Starts the Banking Transactions API.
#
# Usage:
#   ./demo/run.sh                 # start on :3000 with the demo ledger preloaded
#   ./demo/run.sh --no-seed       # start with an empty ledger
#   ./demo/run.sh --port 4000     # start on another port
#   ./demo/run.sh --no-rate-limit # disable the 100 req/min limiter
#
set -euo pipefail

cd "$(dirname "$0")/.."

PORT="${PORT:-3000}"
SEED_FILE="${SEED_FILE:-demo/sample-data.json}"
RATE_LIMIT_ENABLED="${RATE_LIMIT_ENABLED:-true}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --no-seed)       SEED_FILE=""; shift ;;
    --seed)          SEED_FILE="$2"; shift 2 ;;
    --port)          PORT="$2"; shift 2 ;;
    --no-rate-limit) RATE_LIMIT_ENABLED="false"; shift ;;
    -h|--help)       sed -n '2,10p' "$0"; exit 0 ;;
    *) echo "Unknown option: $1" >&2; exit 64 ;;
  esac
done

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is required but was not found on PATH. Install Node.js 20 or newer." >&2
  exit 1
fi

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if (( NODE_MAJOR < 20 )); then
  echo "Node.js 20 or newer is required (found $(node -v))." >&2
  exit 1
fi

if [[ ! -d node_modules ]]; then
  echo "==> Installing dependencies (npm install)"
  npm install --no-audit --no-fund
fi

echo "==> Starting API on http://localhost:${PORT}"
[[ -n "$SEED_FILE" ]] && echo "==> Seeding from ${SEED_FILE}" || echo "==> Starting with an empty ledger"
echo "==> Press Ctrl+C to stop"
echo

exec env PORT="$PORT" SEED_FILE="$SEED_FILE" RATE_LIMIT_ENABLED="$RATE_LIMIT_ENABLED" node src/index.js
