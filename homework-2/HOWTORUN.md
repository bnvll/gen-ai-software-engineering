# How to run

Everything below is copy-pasteable from `homework-2/`.

---

## 1. Prerequisites

| Requirement | Version | Check |
|---|---|---|
| Node.js | **22.5 or newer** (uses `node:sqlite`; developed on 24.4.1) | `node -v` |
| npm | 9 or newer | `npm -v` |
| curl | any | `curl --version` |

No Docker and no API keys. Tickets persist in SQLite at `data/tickets.db`.

---

## 2. Install

```bash
cd gen-ai-software-engineering/homework-2
npm install
```

Direct dependencies: `express`, `multer`.

---

## 3. Start the API and UI

```bash
./demo/run.sh
```

If port 3000 is already taken (common on this machine):

```bash
PORT=3456 ./demo/run.sh
```

```
Customer Support API listening on http://localhost:3456
storage: sqlite (data/tickets.db)
agent UI: open / in a browser
```

Or:

```bash
npm start          # PORT=3000, SQLITE_PATH=data/tickets.db
npm run dev        # auto-restart on file changes
PORT=3456 npm start
SQLITE_PATH=:memory: npm start
```

**Check it is up:**

```bash
curl http://localhost:3456/health
curl http://localhost:3456/api
open http://localhost:3456
```

Stop with `Ctrl+C`.

---

## 4. Sample data

| File | Records |
|---|---|
| `demo/sample_tickets.csv` | 50 |
| `demo/sample_tickets.json` | 20 |
| `demo/sample_tickets.xml` | 30 |
| `demo/invalid_tickets.*` | negative-path files |

Import with auto-classification:

```bash
curl -sS -X POST 'http://localhost:3456/tickets/import?auto_classify=true' \
  -H 'Content-Type: text/csv' \
  --data-binary @demo/sample_tickets.csv
```

```bash
curl -sS -X POST 'http://localhost:3456/tickets/import?auto_classify=true' \
  -H 'Content-Type: application/json' \
  --data-binary @demo/sample_tickets.json
```

```bash
curl -sS -X POST 'http://localhost:3456/tickets/import?auto_classify=true' \
  -H 'Content-Type: application/xml' \
  --data-binary @demo/sample_tickets.xml
```

Multipart (same as the UI):

```bash
curl -sS -X POST 'http://localhost:3456/tickets/import?auto_classify=true' \
  -F 'file=@demo/sample_tickets.csv'
```

Regenerate the sample files:

```bash
node src/utils/generateSamples.js
```

---

## 5. Create / classify / list

```bash
curl -sS -X POST 'http://localhost:3456/tickets?auto_classify=true' \
  -H 'Content-Type: application/json' \
  -d '{
    "customer_id": "CUS-1001",
    "customer_email": "ada@example.com",
    "customer_name": "Ada Lovelace",
    "subject": "Cannot log in after 2FA",
    "description": "I cannot access my account after enabling 2FA this morning."
  }'

curl 'http://localhost:3456/tickets?category=account_access&priority=urgent'

curl -sS -X POST http://localhost:3456/tickets/<id>/auto-classify
```

---

## 6. Tests and coverage

```bash
npm test
npm run test:coverage
```

Expect **57 passing** tests and **>85%** line coverage (last run: **91.27%**).

Coverage screenshot for submission: `docs/screenshots/test_coverage.png` (open `docs/evidence/coverage.html` in a browser and capture it, or screenshot the terminal table from `npm run test:coverage`).

To load 50 demo tickets into SQLite before opening the UI:

```bash
npm run seed
PORT=3456 ./demo/run.sh
```

---

## 7. Environment variables

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `3000` | listen port |
| `HOST` | `0.0.0.0` | bind address |
| `SQLITE_PATH` | `data/tickets.db` | database file, or `:memory:` |
| `LOG_LEVEL` | (unset) | `silent` mutes request logs (tests set this) |
