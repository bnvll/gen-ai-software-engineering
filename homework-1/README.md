# 🏦 Homework 1: Banking Transactions API

> **Student Name**: Simone Benevelli
> **Date Submitted**: 9 September 2026
> **AI Tools Used**: Claude Code (VS Code extension, Claude Opus 5) — full session log in [`docs/ai-usage.md`](docs/ai-usage.md)

A minimal REST API for banking transactions: Node.js 20+, Express 5, in-memory
storage, one runtime dependency, 77 tests.

```bash
./demo/run.sh                  # starts on http://localhost:3000 with a demo ledger
./demo/sample-requests.sh      # exercises every endpoint with curl
npm test                       # 77 tests
```

Prefer a GUI client? Import `demo/postman-collection.json` — 37 requests, one
folder per task, each asserting its status code. See
[`docs/api-client-guide.md`](docs/api-client-guide.md).

Full run instructions: [`HOWTORUN.md`](HOWTORUN.md) ·
API reference: [`docs/api-reference.md`](docs/api-reference.md)

---

## 📋 Project overview

The API records money movements (`deposit`, `withdrawal`, `transfer`) between
accounts identified as `ACC-XXXXX`, and derives everything else from that single
ledger: account balances, an activity summary, projected simple interest and a
CSV export. There is no database and no authentication — restarting the process
empties the ledger.

Design intent, in one line: **be plain on the wire, strict at the edge, and
explicit about money.** The endpoints and response shapes are exactly the ones
`TASKS.md` asks for; the rigour went into validation, currency handling and
documentation rather than into inventing a bigger API.

---

## ✅ What is implemented

### Task 1 — Core API *(required)*

| Method | Endpoint | Status |
|---|---|---|
| `POST` | `/transactions` | ✅ `201` + `Location` header, server-generated UUID |
| `GET` | `/transactions` | ✅ newest first, filterable (Task 3) |
| `GET` | `/transactions/:id` | ✅ `404` on unknown id |
| `GET` | `/accounts/:accountId/balance` | ✅ per currency, `?currency=` for a single one |

Plus `GET /` (machine-readable index of every endpoint and enum) and
`GET /health`.

In-memory storage (array + `Map` index), positive-amount validation, and
`200 / 201 / 400 / 404` — with `413`, `415`, `429` and a JSON `500` handled too,
so no request ever gets an HTML stack trace.

### Task 2 — Validation *(required)*

- **Amount** — positive JSON number, at most 2 decimals; also constrained by the
  currency's ISO 4217 minor unit, so `100.50 JPY` is rejected.
- **Accounts** — `ACC-XXXXX` with 5 alphanumeric characters, case-insensitive and
  normalized to upper case; required/forbidden **per transaction type** (a deposit
  must not carry a `fromAccount`, a transfer's two accounts must differ).
- **Currency** — ISO 4217 code from a supported list, any case.
- **Also validated** — `type` and `status` enums, ISO 8601 `timestamp`
  (`2024-02-31` is rejected), every query parameter, and the `:accountId` path
  parameter.
- **All errors at once**, in the exact shape the assignment specifies:

```json
{
  "error": "Validation failed",
  "details": [
    { "field": "amount", "message": "Amount must be a positive number" },
    { "field": "currency", "message": "Invalid currency code. Use a supported ISO 4217 code (e.g. USD, EUR, GBP, JPY)" }
  ]
}
```

### Task 3 — Transaction history *(required)*

`GET /transactions` filters, all combinable and all validated:

| Filter | Example |
|---|---|
| Account (either side) | `?accountId=ACC-12345` |
| Type | `?type=transfer` |
| Date range (inclusive) | `?from=2024-01-01&to=2024-01-31` |
| Status *(extra)* | `?status=pending` |
| Currency *(extra)* | `?currency=USD` |
| Combined | `?accountId=ACC-12345&type=transfer&from=2024-01-01&to=2024-01-31` |

A bare date covers the whole UTC day, so `to=2024-01-31` includes
`2024-01-31T23:59:59Z`; full ISO 8601 instants are accepted too. An invalid
filter value returns `400` rather than an empty list.

### Task 4 — Additional features: **all four options** *(1 required)*

| Option | Endpoint | Notes |
|---|---|---|
| **A. Summary** | `GET /accounts/:accountId/summary` | Deposits, withdrawals, transfers in/out, net change, transaction count, most recent transaction date, plus a `statusBreakdown` |
| **B. Simple interest** | `GET /accounts/:accountId/interest?rate=0.05&days=30` | `balance × rate × days / 365`, rounded to the currency's minor unit |
| **C. CSV export** | `GET /transactions/export?format=csv` | RFC 4180, `Content-Disposition` attachment, **honours every list filter**, `format=json` also supported |
| **D. Rate limiting** | every endpoint | 100 requests/minute per IP, `429` + `Retry-After`, `X-RateLimit-*` headers on every response, configurable and switchable |

---

## 🏗 Architecture

```
routes/        HTTP only — read params, set status codes and headers
validators/    reject bad input, normalize good input
services/      derived read models (balance, summary, interest, CSV)
models/        the transaction record + the in-memory store
middleware/    rate limiting, request logging, JSON guard, 404, error renderer
utils/         money, currencies, dates, account numbers, errors, logging
```

Five decisions worth knowing before reading the code — the reasoning for these
and eight more is in [`docs/architecture-decisions.md`](docs/architecture-decisions.md):

1. **Money is stored as integer minor units** (cents), never as floats. Summing
   floats gives `0.1 + 0.2 = 0.30000000000000004`; a balance endpoint cannot
   return that.
2. **Amounts in different currencies are never summed.** Balances and totals are
   reported per currency; `?currency=` narrows them to one.
3. **Only `completed` transactions move money.** `pending` and `failed` are
   stored and listed but excluded from balances — and the summary says how many
   were excluded, so the number stays explainable.
4. **Accounts are derived from the ledger.** No account resource: an account
   exists once a transaction references it, which is what makes the `404`
   meaningful.
5. **The app is a factory** (`createApp({ store, rateLimit })`), so each test
   runs the real app on an ephemeral port with its own store and its own limiter
   configuration.

### Project structure

```
homework-1/
├── README.md                   ← this file
├── HOWTORUN.md                 ← step-by-step run & test guide
├── package.json                ← one dependency: express
├── .gitignore
├── src/
│   ├── index.js                ← process bootstrap (port, seeding, signals)
│   ├── app.js                  ← Express app factory
│   ├── routes/                 ← transactions.js, accounts.js
│   ├── models/                 ← transaction.js, transactionStore.js
│   ├── validators/             ← transactionValidator.js, queryValidator.js
│   ├── services/               ← accountService.js, csvExporter.js
│   ├── middleware/             ← rateLimit, requestLogger, requireJsonBody, notFound, errorHandler
│   └── utils/                  ← money, currencies, dates, accounts, errors, logger, seed
├── tests/                      ← 77 tests, node:test runner (no test dependencies)
│   ├── transactions.test.js    ← CRUD, defaults, error handling
│   ├── validation.test.js      ← Task 2
│   ├── filters.test.js         ← Task 3
│   ├── accounts.test.js        ← balance, summary, interest arithmetic
│   ├── export.test.js          ← CSV export
│   ├── rateLimit.test.js       ← 429 behaviour
│   └── units.test.js           ← money & date utilities
├── docs/
│   ├── api-reference.md        ← full endpoint reference (standards, errors, examples)
│   ├── api-client-guide.md     ← testing with Postman
│   ├── architecture-decisions.md
│   ├── ai-usage.md             ← prompts, AI workflow, what the AI got wrong
│   ├── PULL_REQUEST.md         ← ready-to-paste PR description
│   ├── screenshots/            ← screenshot checklist + images
│   └── evidence/               ← transcripts from demo/capture-evidence.sh
└── demo/
    ├── run.sh / run.bat        ← start the API
    ├── sample-requests.sh      ← every endpoint via curl
    ├── sample-requests.http    ← VS Code REST Client / JetBrains HTTP client
    ├── postman-collection.json ← 37 requests + status assertions
    ├── postman-environment.json
    ├── sample-data.json        ← 10-transaction demo ledger
    └── capture-evidence.sh     ← records transcripts into docs/evidence/
```

---

## 🧪 Tests

```bash
npm test              # 77 tests
npm run test:coverage # with V8 coverage
```

No test framework is installed — the suite uses Node's built-in `node:test`
runner and `fetch` against the real app on an ephemeral port, so every test
exercises actual HTTP behaviour (status codes, headers, JSON shape) rather than
mocks.

Coverage by area: CRUD and defaults, every validation rule, every filter and
filter combination, balance/summary/interest arithmetic (including
multi-currency and pending/failed exclusion), CSV formatting and escaping, rate
limiting and its configuration, and the money/date utilities.

---

## 🤖 AI usage summary

Claude Code (Claude Opus 5) planned and wrote this implementation from
`TASKS.md`. The parts worth reporting:

- It **asked four clarifying questions before writing code** (stack, how many
  Task 4 options, how much Qonto/Solaris-style convention to put on the wire,
  how to handle screenshots) — the third answer, "keep the API plain", is what
  kept the implementation aligned with the assignment.
- It **fetched the real Qonto and Solaris documentation** rather than recalling
  it, which is why the reference documents conventions before endpoints and why
  behaviours like "unknown parameters are ignored" match the real thing.
- It **got the interest calculation subtly wrong** on the first pass — a dead
  `* 0` term that left the endpoint working while the code made no sense. Reading
  the output caught what the tests could not; the fix was structural.
- Everything reported here was **verified by running it**: 77 passing tests, a
  31-request transcript, and every example in the API reference pasted from a
  real response.

The full log — prompts, tool calls, mistakes, and the lessons worth reusing — is
in [`docs/ai-usage.md`](docs/ai-usage.md).

---

<div align="center">

*This project was completed as part of the AI-Assisted Development course.*

</div>
