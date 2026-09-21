#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
export PORT="${PORT:-3000}"
export SQLITE_PATH="${SQLITE_PATH:-data/tickets.db}"
echo "Starting customer support API on http://localhost:${PORT}"
exec node src/index.js
