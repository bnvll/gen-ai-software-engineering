#!/usr/bin/env bash
#
# Captures runnable evidence for the homework submission:
#
#   docs/evidence/test-output.txt     full `npm test` run
#   docs/evidence/server-startup.txt  server boot log
#   docs/evidence/api-transcript.txt  every sample request with its response
#
# These text transcripts back up the screenshots in docs/screenshots/ (and make
# it obvious which screenshots still need to be taken by hand — see
# docs/screenshots/README.md).
#
# Usage: ./demo/capture-evidence.sh [--port 3100]
#
set -uo pipefail

cd "$(dirname "$0")/.."

PORT="${PORT:-3100}"
[[ "${1:-}" == "--port" ]] && PORT="$2"

EVIDENCE_DIR="docs/evidence"
mkdir -p "$EVIDENCE_DIR"

echo "==> 1/3 Running the test suite"
npm test > "${EVIDENCE_DIR}/test-output.txt" 2>&1
TEST_EXIT=$?
tail -9 "${EVIDENCE_DIR}/test-output.txt"
[[ $TEST_EXIT -eq 0 ]] || echo "   (tests failed — see ${EVIDENCE_DIR}/test-output.txt)"

echo
echo "==> 2/3 Starting the API on :${PORT} with the demo ledger"
PORT="$PORT" SEED_FILE=demo/sample-data.json node src/index.js > "${EVIDENCE_DIR}/server-startup.txt" 2>&1 &
SERVER_PID=$!
trap 'kill "$SERVER_PID" 2>/dev/null' EXIT

for _ in $(seq 1 40); do
  curl -sS -o /dev/null "http://localhost:${PORT}/health" 2>/dev/null && break
  sleep 0.25
done

if ! curl -sS -o /dev/null "http://localhost:${PORT}/health" 2>/dev/null; then
  echo "The API did not come up. See ${EVIDENCE_DIR}/server-startup.txt" >&2
  exit 1
fi
cat "${EVIDENCE_DIR}/server-startup.txt"

echo
echo "==> 3/3 Recording the sample requests"
{
  echo "Banking Transactions API — request/response transcript"
  echo "Captured: $(date -u '+%Y-%m-%dT%H:%M:%SZ')"
  echo "Node:     $(node -v)"
  echo
  BASE_URL="http://localhost:${PORT}" ./demo/sample-requests.sh
} > "${EVIDENCE_DIR}/api-transcript.txt" 2>&1

# The request log the server produced while serving the transcript.
cat "${EVIDENCE_DIR}/server-startup.txt" > "${EVIDENCE_DIR}/server-request-log.txt"

sed -e 's/\x1b\[[0-9;]*m//g' -i.bak "${EVIDENCE_DIR}/api-transcript.txt" 2>/dev/null || true
rm -f "${EVIDENCE_DIR}/api-transcript.txt.bak"

echo "    $(grep -c '^── ' "${EVIDENCE_DIR}/api-transcript.txt" || echo 0) requests recorded"
echo
echo "Evidence written to ${EVIDENCE_DIR}/:"
ls -la "$EVIDENCE_DIR"
echo
echo "Next: take the screenshots listed in docs/screenshots/README.md"
