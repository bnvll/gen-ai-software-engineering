<!--
  This file IS the pull request body: paste it verbatim into the PR on your fork
  (branch homework-1-submission -> main), or pass it to
  `gh pr create --body-file`.

  Suggested PR title:
    Homework 1: Banking Transactions API (Node.js + Express)

  Before opening the PR, drag the three screenshots from docs/screenshots/ into
  the placeholders in the Screenshots section below.

  HTML comments do not render on GitHub, so this block stays invisible.
-->

## Homework 1 — Banking Transactions API (Node.js + Express)

A minimal REST API for banking transactions built with Claude Code, covering
**all three required tasks and all four Task 4 options**. Node.js 20+, Express 5,
in-memory storage, one runtime dependency, 77 passing tests.

### 📦 What is in this PR

| Task | Delivered |
|---|---|
| **1. Core API** *(required)* | `POST /transactions`, `GET /transactions`, `GET /transactions/:id`, `GET /accounts/:accountId/balance` — in-memory store, positive-amount validation, `200/201/400/404` plus `413/415/429` and a JSON `500` |
| **2. Validation** *(required)* | Amount (positive, ≤ 2 decimals, **and** within the currency's ISO 4217 minor unit), account format `ACC-XXXXX`, ISO 4217 currency, enum + ISO 8601 checks, all errors returned at once in the specified `{ error, details[] }` shape |
| **3. History filters** *(required)* | `?accountId=`, `?type=`, `?from=&to=` (inclusive whole UTC days), plus `?status=` and `?currency=`, all combinable and all validated |
| **4A. Summary** | `GET /accounts/:accountId/summary` — deposits, withdrawals, transfers in/out, net change, counts, most recent transaction date, `statusBreakdown` |
| **4B. Simple interest** | `GET /accounts/:accountId/interest?rate=0.05&days=30` — `balance × rate × days / 365` |
| **4C. CSV export** | `GET /transactions/export?format=csv` — RFC 4180, attachment headers, honours every list filter, `format=json` too |
| **4D. Rate limiting** | 100 req/min per IP, `429` + `Retry-After`, `X-RateLimit-*` on every response, configurable and switchable |

Extras beyond the brief: `GET /` service index (every endpoint + enum values),
`GET /health`, a seedable demo ledger, a runnable evidence capture script,
and an importable **Postman collection** (37 requests, one folder per task,
each asserting its status code).

### 🏗 How it is built

```
routes/      HTTP only  ·  validators/  input rules  ·  services/  derived read models
models/      transaction + in-memory store  ·  middleware/  rate limit, logging, errors
utils/       money, currencies, dates, accounts, errors
```

Five decisions a reviewer should know (full reasoning, and eight more, in
[`docs/architecture-decisions.md`](docs/architecture-decisions.md)):

1. **Money is stored as integer minor units**, never floats — a balance endpoint
   must not return `0.30000000000000004`.
2. **Amounts in different currencies are never summed** — balances and totals are
   per currency, with `?currency=` to narrow them.
3. **Only `completed` transactions move money** — `pending`/`failed` are stored
   and listed, and the summary reports how many were excluded.
4. **Accounts are derived from the ledger** — no account resource, which is what
   makes the required `404` meaningful.
5. **The app is a factory** — every test runs the real app on an ephemeral port
   with its own store and limiter config.

### 🤖 AI tools used

**Claude Code (VS Code extension, Claude Opus 5)** — planning, implementation,
tests and documentation. Full log with prompts and tool calls:
[`docs/ai-usage.md`](docs/ai-usage.md).

Worth calling out:

- It **asked four clarifying questions before writing any code** (stack, how many
  Task 4 options, how much Qonto/Solaris-style convention to put on the wire,
  how to handle screenshots). Choosing "keep the API plain" is what kept the
  implementation aligned with `TASKS.md` instead of drifting into a fancier API.
- It **fetched the real Qonto and Solaris API docs** instead of recalling them,
  which is why `docs/api-reference.md` documents standards before endpoints and
  why behaviours like "unknown parameters are ignored" match the real products.
- It **got the interest calculation subtly wrong** on the first pass: a dead
  `* 0` term left the endpoint returning plausible numbers while the code made no
  sense. Reading the generated code caught what a passing test could not — the
  fix was structural (an internal minor-units layer so no code reverses a
  formatted amount).
- A generated npm script (`node --test tests/`) **did not actually work** on
  Node 24; running it surfaced the failure and it now uses the glob form.

### ⚠️ Challenges and how they were handled

| Challenge | Resolution |
|---|---|
| **Floating-point money** — cent sums drift | All arithmetic in integer minor units; a test asserts `0.1 + 0.1 + 0.1` deposits give exactly `0.3` |
| **Multi-currency accounts** — what is "the balance" of an account holding USD and JPY? | Never sum across currencies: report per currency, add `?currency=` for a single figure, and return `400` (not a wrong number) when interest is requested ambiguously |
| **`status` in the required model** but no state-transition endpoint | `status` is accepted on create and defaults to `completed`; only completed transactions affect balances, and the summary exposes the excluded counts |
| **Date-range off-by-one** — does `to=2024-01-31` include that day? | A bare date expands to the whole UTC day, both bounds inclusive; full ISO 8601 instants are used verbatim. Both are tested |
| **Route shadowing** — `/transactions/export` vs `/transactions/:id` | `export` is registered first, and a regression test pins it |
| **Validation strictness vs. client friendliness** | Strict on known fields and enums, lenient on unknown fields and query parameters (forward compatibility), and every field error reported in one response |

### 🔍 How to verify

```bash
cd gen-ai-software-engineering/homework-1
npm install
npm test                    # 77 tests, 77 passing

./demo/run.sh               # http://localhost:3000, demo ledger preloaded
./demo/sample-requests.sh   # ~30 requests: every endpoint, success and failure cases
```

Or import `demo/postman-collection.json` + `demo/postman-environment.json` and
run the collection — 37 requests, 37 assertions, verified with `newman`.

Then, in a second terminal:

```bash
curl -X POST http://localhost:3000/transactions \
  -H "Content-Type: application/json" \
  -d '{"fromAccount":"ACC-12345","toAccount":"ACC-67890","amount":100.50,"currency":"USD","type":"transfer"}'

curl "http://localhost:3000/transactions?accountId=ACC-12345&type=transfer&from=2024-01-01&to=2024-01-31"
curl http://localhost:3000/accounts/ACC-12345/balance
curl "http://localhost:3000/accounts/ACC-12345/interest?rate=0.05&days=30&currency=USD"
curl "http://localhost:3000/transactions/export?format=csv"
```

Full instructions, environment variables and troubleshooting:
[`HOWTORUN.md`](HOWTORUN.md). API reference:
[`docs/api-reference.md`](docs/api-reference.md). Text transcripts of a real run
(tests, startup log, 31 recorded requests): `docs/evidence/`.

### 📸 Screenshots

<!-- Drag the files from docs/screenshots/ onto these lines. -->

**1. AI tool interaction — the prompt and the code it generated**

_(ai-prompt.png)_

**2. The API running successfully**

_(api-running.png)_

**3. Sample requests and responses (Postman)**

_(postman-requests.png)_

### ✅ Checklist

- [x] All required tasks (1, 2, 3) implemented
- [x] Task 4: all four options implemented (one was required)
- [x] In-memory storage, no database
- [x] `README.md` and `HOWTORUN.md`
- [x] `.gitignore` excluding `node_modules/`, `.env`, logs, coverage
- [x] `demo/run.sh` (+ `run.bat`), `demo/sample-requests.http`,
      `demo/sample-requests.sh`, `demo/sample-data.json`
- [x] AI usage documented (`docs/ai-usage.md`)
- [x] 77 automated tests, all passing
- [x] All three screenshots from `TASKS.md` added to `docs/screenshots/`
- [ ] Screenshots embedded in this PR body
- [ ] Reviewer assigned: **Alexey-Popov**; labels `homework-1`, `ready-for-review`
