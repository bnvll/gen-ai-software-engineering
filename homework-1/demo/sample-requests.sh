#!/usr/bin/env bash
#
# Exercises every endpoint of the Banking Transactions API with curl.
#
# Start the API first (./demo/run.sh), then:
#   ./demo/sample-requests.sh                     # against http://localhost:3000
#   BASE_URL=http://localhost:4000 ./demo/sample-requests.sh
#   ./demo/sample-requests.sh --rate-limit        # also demo the 429 response
#
# The script assumes the demo ledger from demo/sample-data.json is loaded
# (that is what ./demo/run.sh does by default).
#
set -uo pipefail

BASE_URL="${BASE_URL:-http://localhost:3000}"
SHOW_RATE_LIMIT=false
[[ "${1:-}" == "--rate-limit" ]] && SHOW_RATE_LIMIT=true

bold() { printf '\033[1m%s\033[0m\n' "$1"; }

# Pretty-print a JSON body when node is available, otherwise print it raw.
pretty() { node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{console.log(JSON.stringify(JSON.parse(d),null,2))}catch{process.stdout.write(d)}})' 2>/dev/null || cat; }

# req <title> <method> <path> [json-body]
req() {
  local title="$1" method="$2" path="$3" body="${4:-}"
  bold "── ${title}"
  echo "\$ curl -X ${method} ${BASE_URL}${path}${body:+ -d '...'}"
  local response status
  if [[ -n "$body" ]]; then
    response="$(curl -sS -w $'\n%{http_code}' -X "$method" "${BASE_URL}${path}" \
      -H 'Content-Type: application/json' -d "$body")"
  else
    response="$(curl -sS -w $'\n%{http_code}' -X "$method" "${BASE_URL}${path}")"
  fi
  status="$(tail -n1 <<<"$response")"
  echo "HTTP ${status}"
  sed '$d' <<<"$response" | pretty
  echo
}

if ! curl -sS -o /dev/null "${BASE_URL}/health"; then
  echo "Cannot reach ${BASE_URL}. Start the API with ./demo/run.sh first." >&2
  exit 1
fi

bold "Banking Transactions API — sample requests against ${BASE_URL}"
echo

req "Service index (available endpoints)" GET "/"
req "Health probe" GET "/health"

bold "═══ Task 1: core endpoints ═══"; echo
req "Create a transfer" POST "/transactions" '{
  "fromAccount": "ACC-12345",
  "toAccount": "ACC-67890",
  "amount": 100.50,
  "currency": "USD",
  "type": "transfer"
}'
req "Create a deposit (no fromAccount: money enters the ledger)" POST "/transactions" '{
  "toAccount": "ACC-12345",
  "amount": 2500.00,
  "currency": "USD",
  "type": "deposit"
}'
req "Create a withdrawal (no toAccount: money leaves the ledger)" POST "/transactions" '{
  "fromAccount": "ACC-12345",
  "amount": 99.99,
  "currency": "USD",
  "type": "withdrawal"
}'

# Capture one id so we can fetch it back.
TXN_ID="$(curl -sS -X POST "${BASE_URL}/transactions" -H 'Content-Type: application/json' \
  -d '{"toAccount":"ACC-A1B2C","amount":10.00,"currency":"EUR","type":"deposit","status":"pending"}' \
  | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{console.log(JSON.parse(d).id)}catch{}})')"

req "List all transactions (newest first)" GET "/transactions"
req "Retrieve a single transaction" GET "/transactions/${TXN_ID}"
req "Balance of ACC-12345 (per currency)" GET "/accounts/ACC-12345/balance"
req "Balance of ACC-12345 in USD only" GET "/accounts/ACC-12345/balance?currency=USD"

bold "═══ Task 2: validation ═══"; echo
req "Every field invalid at once → 400" POST "/transactions" '{
  "fromAccount": "ACC-1",
  "amount": -5.999,
  "currency": "XYZ",
  "type": "wire"
}'
req "Amount with 3 decimals → 400" POST "/transactions" '{
  "fromAccount": "ACC-12345", "toAccount": "ACC-67890",
  "amount": 10.555, "currency": "USD", "type": "transfer"
}'
req "0.50 JPY does not exist → 400" POST "/transactions" '{
  "toAccount": "ACC-12345", "amount": 100.50, "currency": "JPY", "type": "deposit"
}'
req "Transfer to the same account → 400" POST "/transactions" '{
  "fromAccount": "ACC-12345", "toAccount": "ACC-12345",
  "amount": 10, "currency": "USD", "type": "transfer"
}'
req "Unknown transaction → 404" GET "/transactions/00000000-0000-4000-8000-000000000000"
req "Unknown account → 404" GET "/accounts/ACC-99999/balance"
req "Malformed account number → 400" GET "/accounts/12345/balance"
req "Unknown route → 404" GET "/not-a-route"

bold "═══ Task 3: transaction history filters ═══"; echo
req "By account" GET "/transactions?accountId=ACC-12345"
req "By type" GET "/transactions?type=transfer"
req "By date range (January 2024, inclusive)" GET "/transactions?from=2024-01-01&to=2024-01-31"
req "Combined: account + type + date range" GET "/transactions?accountId=ACC-12345&type=transfer&from=2024-01-01&to=2024-01-31"
req "Extra filters: status and currency" GET "/transactions?status=pending&currency=USD"
req "Invalid filter values → 400" GET "/transactions?type=wire&from=15/01/2024"

bold "═══ Task 4: summary, interest, CSV export, rate limiting ═══"; echo
req "Account summary" GET "/accounts/ACC-12345/summary"
req "Account summary (USD only)" GET "/accounts/ACC-12345/summary?currency=USD"
req "Simple interest: 5% for 30 days on the USD balance" GET "/accounts/ACC-12345/interest?rate=0.05&days=30&currency=USD"
req "Interest without ?currency= on a multi-currency account → 400" GET "/accounts/ACC-12345/interest?rate=0.05&days=30"
req "Interest with an invalid rate → 400" GET "/accounts/ACC-12345/interest?rate=5&days=30&currency=USD"

bold "── CSV export (headers + first rows)"
echo "\$ curl -i ${BASE_URL}/transactions/export?format=csv"
curl -sS -i "${BASE_URL}/transactions/export?format=csv" | head -20
echo
bold "── CSV export filtered by account"
echo "\$ curl \"${BASE_URL}/transactions/export?format=csv&accountId=ACC-12345\""
curl -sS "${BASE_URL}/transactions/export?format=csv&accountId=ACC-12345"
echo

if [[ "$SHOW_RATE_LIMIT" == true ]]; then
  bold "── Rate limiting: 100 requests/minute per IP"
  echo "Sending 105 requests to /health ..."
  local_status=""
  for i in $(seq 1 105); do
    local_status="$(curl -sS -o /dev/null -w '%{http_code}' "${BASE_URL}/health")"
    if [[ "$local_status" == "429" ]]; then
      echo "Request #${i} → HTTP 429"
      break
    fi
  done
  echo "\$ curl -i ${BASE_URL}/health   # after the limit is exceeded"
  curl -sS -i "${BASE_URL}/health" | head -12
  echo
  echo "(The limiter resets after 60s. Restart with ./demo/run.sh --no-rate-limit to disable it.)"
else
  bold "── Rate limiting"
  echo "Skipped: re-run with --rate-limit to fire 105 requests and see the 429 response."
  echo "\$ curl -i ${BASE_URL}/health   # X-RateLimit-* headers are on every response"
  curl -sS -i "${BASE_URL}/health" | head -8
  echo
fi

bold "Done."
