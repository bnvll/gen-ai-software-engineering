# How to run

Everything below is copy-pasteable from the `homework-1/` directory.

---

## 1. Prerequisites

| Requirement | Version | Check |
|---|---|---|
| Node.js | **20 or newer** (developed on 24.4.1) | `node -v` |
| npm | 9 or newer | `npm -v` |
| curl | any | `curl --version` |

No database, no Docker, no environment file and no API keys are needed. The
ledger lives in memory.

> Windows: use `demo\run.bat` instead of `./demo/run.sh`, or run the `npm`
> commands directly. Git Bash / WSL can run the shell scripts as-is.

---

## 2. Install

```bash
cd gen-ai-software-engineering/homework-1
npm install
```

Installs one direct dependency (`express`). `demo/run.sh` runs this for you if
`node_modules/` is missing.

---

## 3. Start the API

**Recommended — demo script (preloads 10 sample transactions):**

```bash
./demo/run.sh
```

```
2026-09-09T07:44:12.500Z [info] seeded 10 transactions from demo/sample-data.json
2026-09-09T07:44:12.504Z [info] Banking Transactions API listening on http://localhost:3000
2026-09-09T07:44:12.504Z [info] storage: in-memory (10 transactions loaded)
2026-09-09T07:44:12.504Z [info] rate limit: 100 requests / 60s per IP
```

Options:

```bash
./demo/run.sh --no-seed          # start with an empty ledger
./demo/run.sh --port 4000        # listen on another port
./demo/run.sh --no-rate-limit    # disable the 100 req/min limiter
```

**Plain npm:**

```bash
npm start                        # empty ledger on :3000
npm run seed                     # ledger preloaded from demo/sample-data.json
npm run dev                       # auto-restart on file changes (node --watch)
```

Stop the server with `Ctrl+C` (it shuts down on `SIGINT`/`SIGTERM`).

**Check it is up:**

```bash
curl http://localhost:3000/health
# {"status":"ok","uptimeSeconds":3.2,"transactionCount":10}

curl http://localhost:3000/
# machine-readable index of every endpoint, plus the accepted enum values
```

---

## 4. Try it out

### Option A — the curl script (fastest full tour)

In a second terminal, with the server running:

```bash
./demo/sample-requests.sh                    # ~30 requests: all tasks, success + error cases
./demo/sample-requests.sh --rate-limit       # also fires 105 requests to show the 429
BASE_URL=http://localhost:4000 ./demo/sample-requests.sh
```

### Option B — VS Code REST Client / JetBrains HTTP client

Open [`demo/sample-requests.http`](demo/sample-requests.http) and click
**Send Request** above any block. It is grouped by task and includes the failure
cases. (VS Code: install the `humao.rest-client` extension.)

### Option C — Postman

`demo/postman-collection.json` covers all 37 requests, grouped by task, each
with a test asserting its status code. Import it together with
`demo/postman-environment.json`, select the **Banking API — local**
environment, set `baseUrl` to your port, and run the collection. Step-by-step
instructions: [`docs/api-client-guide.md`](docs/api-client-guide.md).

### Option D — curl by hand

```bash
# Create a transaction
curl -X POST http://localhost:3000/transactions \
  -H "Content-Type: application/json" \
  -d '{
    "fromAccount": "ACC-12345",
    "toAccount": "ACC-67890",
    "amount": 100.50,
    "currency": "USD",
    "type": "transfer"
  }'

# List all transactions (newest first)
curl http://localhost:3000/transactions

# Filter: account + type + date range
curl "http://localhost:3000/transactions?accountId=ACC-12345&type=transfer&from=2024-01-01&to=2024-01-31"

# Retrieve one transaction
curl http://localhost:3000/transactions/<id>

# Account balance (per currency), then a single currency
curl http://localhost:3000/accounts/ACC-12345/balance
curl "http://localhost:3000/accounts/ACC-12345/balance?currency=USD"

# Task 4: summary, simple interest, CSV export
curl http://localhost:3000/accounts/ACC-12345/summary
curl "http://localhost:3000/accounts/ACC-12345/interest?rate=0.05&days=30&currency=USD"
curl "http://localhost:3000/transactions/export?format=csv" -o transactions.csv

# Task 4: rate limiting — every response carries the budget
curl -i http://localhost:3000/health | grep -i ratelimit
```

Validation in action:

```bash
curl -X POST http://localhost:3000/transactions \
  -H "Content-Type: application/json" \
  -d '{"fromAccount":"ACC-1","amount":-5.999,"currency":"XYZ","type":"wire"}'
```

```json
{
  "error": "Validation failed",
  "details": [
    { "field": "type", "message": "Type must be one of: deposit, withdrawal, transfer" },
    { "field": "fromAccount", "message": "Account number must match ACC-XXXXX, where X is alphanumeric (e.g. ACC-12345)" },
    { "field": "currency", "message": "Invalid currency code. Use a supported ISO 4217 code (e.g. USD, EUR, GBP, JPY)" },
    { "field": "amount", "message": "Amount must be a positive number" }
  ]
}
```

The demo ledger uses `ACC-12345`, `ACC-67890` and `ACC-A1B2C`, with USD, EUR and
JPY transactions dated January–February 2024 — so the date-range filters in the
examples return data. `ACC-12345` holds both USD and JPY, which is what makes the
per-currency balance and the `?currency=` selector visible.

---

## 5. Testing

```bash
npm test
```

```
ℹ tests 77
ℹ pass 77
ℹ fail 0
```

```bash
npm run test:coverage                              # with V8 coverage
node --test tests/validation.test.js               # one file
node --test --test-name-pattern "interest" "tests/**/*.test.js"   # by name
```

The suite starts the real Express app on an ephemeral port for each test, so no
server needs to be running and the tests never collide with a local instance on
`:3000`.

> Note: `node --test tests/` (directory form) fails on Node 24 — use the glob
> form `node --test "tests/**/*.test.js"`, which is what `npm test` does.

---

## 6. Capture evidence for the submission

```bash
./demo/capture-evidence.sh          # uses port 3100 to avoid clashing with :3000
```

Writes to `docs/evidence/`:

| File | Content |
|---|---|
| `test-output.txt` | full `npm test` run |
| `server-startup.txt` | server boot log |
| `api-transcript.txt` | every sample request with its response and status code |
| `server-request-log.txt` | the request log the server produced while serving them |

Screenshots still have to be taken by hand — the three `TASKS.md` asks for are
listed in [`docs/screenshots/README.md`](docs/screenshots/README.md), with what
must be visible in each.

---

## 7. Environment variables

All optional; the defaults are what `npm start` uses.

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | Port to listen on |
| `HOST` | `0.0.0.0` | Interface to bind |
| `SEED_FILE` | *(unset)* | JSON file of transactions to preload, e.g. `demo/sample-data.json` |
| `RATE_LIMIT_ENABLED` | `true` | `false` disables the limiter |
| `RATE_LIMIT_MAX` | `100` | Requests allowed per window |
| `RATE_LIMIT_WINDOW_MS` | `60000` | Window length in milliseconds |
| `LOG_LEVEL` | *(unset)* | `silent` mutes request logging (the test suite sets this) |

```bash
# a small limit makes the 429 easy to demonstrate
RATE_LIMIT_MAX=5 npm run seed


# a quiet server on another port
PORT=4000 LOG_LEVEL=silent npm start
```

Seed files are validated by the same validator as HTTP requests: an invalid row
stops start-up with `Seed row 3 is invalid -> amount: Amount must be a positive
number` and exit code 1.

---

## 8. Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `port 3000 is already in use` | Another process (or an earlier run) holds the port. `PORT=4000 npm start`, or `lsof -ti:3000 \| xargs kill`. |
| `Cannot find module 'express'` | Dependencies not installed: `npm install`. |
| `429 Too Many Requests` while testing | The 100 req/min budget is spent. Wait for the `Retry-After` seconds, or restart with `./demo/run.sh --no-rate-limit`. |
| All transactions disappeared | Storage is in memory — restarting empties it. Use `npm run seed` or `./demo/run.sh` to reload the demo ledger. |
| `415 Unsupported Media Type` on POST | Add `-H "Content-Type: application/json"`. |
| `400 … Request body is not valid JSON` | Malformed JSON — check quoting, especially in PowerShell (use `demo/sample-requests.http` instead). |
| `404` on `/accounts/ACC-.../balance` | No transaction references that account yet; accounts are derived from the ledger. Create a transaction first. |
| `Cannot reach http://localhost:3000` from `sample-requests.sh` | The server is not running, or is on another port: `BASE_URL=http://localhost:4000 ./demo/sample-requests.sh`. |
| `permission denied: ./demo/run.sh` | `chmod +x demo/*.sh`. |
