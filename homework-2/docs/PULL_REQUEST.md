<!--
  This file IS the pull request body: paste it verbatim into the PR on your fork
  (branch homework-2-submission -> main), or pass it to
  `gh pr create --body-file`.

  Suggested PR title:
    Homework 2: Intelligent Customer Support System (Node.js + Express + SQLite)

  Before opening the PR, drag the screenshots from docs/screenshots/ into
  the placeholders in the Screenshots section below.

  HTML comments do not render on GitHub, so this block stays invisible.
-->

## Homework 2 — Intelligent Customer Support System

A ticket API plus an agent web UI: multi-format import (CSV / JSON / XML),
rule-based auto-classification, SQLite persistence, and a same-origin front-end.
Built in Cursor (Grok 4.6) with the **Context-Model-Prompt** steps logged in
[`docs/ai-usage.md`](docs/ai-usage.md). Node.js 22.5+ (`node:sqlite`), Express 5,
**57 passing tests**, **91.27%** line coverage.

### 📦 What is in this PR

| Task | Delivered |
|---|---|
| **1. Multi-format import API** | `POST/GET/PUT/DELETE /tickets`, `GET /tickets/:id`, `POST /tickets/import` — CSV, JSON and XML (raw body or multipart `file`); validation of email, lengths and enums; bulk `{ total, successful, failed, errors[] }`; malformed files → `400` |
| **2. Auto-classification** | Keyword engine from the `TASKS.md` lists (not an LLM). `POST /tickets/:id/auto-classify` returns category, priority, confidence (0–1), reasoning, `keywords_found`. Optional `?auto_classify=true` on create and import. Append-only `classification_log`. Manual override via `PUT` is logged |
| **3. AI-generated test suite** | Eight required files under `tests/` (57 tests). Line coverage **91.27%** (`npm run test:coverage`) |
| **4. Multi-level documentation** | `README.md` (developers), `HOWTORUN.md` (operators), `docs/API_REFERENCE.md` (consumers), `docs/ARCHITECTURE.md` (leads), `docs/TESTING_GUIDE.md` (QA). Three+ Mermaid diagrams. Distinct **Context / Model / Prompt** per audience |
| **5. Front-end** | Vanilla HTML/CSS/JS in `public/`, served by Express. List + filters, create/edit with client-side validation, details (classification + metadata), bulk import, auto-classify, success/error banners, responsive layout |
| **6. Integration & performance** | Full ticket lifecycle, import + classify, combined filters, 25 concurrent creates, 40-row import, in-process classifier budget |

Sample data: `demo/sample_tickets.csv` (50), `.json` (20), `.xml` (30), plus
`demo/invalid_tickets.*` for negative paths.

### 🏗 How it is built

```
routes/        HTTP + import body (raw vs multipart)
validators/    email, lengths, enums — all errors at once
services/      CSV/JSON/XML parser, keyword classifier
stores/        TicketStore (CRUD, filters, decision log, resolved_at)
db.js          node:sqlite schema (tickets + classification_log)
public/        agent UI — no hardcoded tickets
```

Decisions a reviewer should know (full write-up in
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)):

1. **SQLite via `node:sqlite`**, not an extra native addon — homework 1 was
   in-memory; this assignment needs persistence for UI demos. Tests use `:memory:`.
2. **Keyword classifier, not an LLM** — the brief lists exact phrases and asks
   for `keywords_found`. Deterministic, free, testable.
3. **Import never aborts the batch on a bad row** — only unreadable files fail
   the whole request.
4. **Same-origin UI** — `./demo/run.sh` is the whole demo; no second port or CORS.
5. **Classification log is append-only** — auto-create, auto-import, auto-endpoint
   and manual PUT all insert a row.

### 🤖 AI tools used

**Cursor (Grok 4.6)** — planning, implementation, tests and documentation.
Full Context-Model-Prompt log: [`docs/ai-usage.md`](docs/ai-usage.md).

Worth calling out:

- It **asked clarifying questions before coding** (CMP evidence, stack, UI,
  rules vs LLM). SQLite + a rule engine + vanilla UI are those answers, not
  defaults guessed from a generic “support desk” template.
- **CMP is applied per artifact**: each doc has a named audience (Context), a
  model choice and rationale (Model), and a constrained instruction (Prompt).
  Task 4’s “different models for different doc types” is recorded honestly:
  prompts and context blocks differ; this submission was one Cursor session
  rather than four unverified model IDs writing four slightly different APIs.
- **Validation tests asserted on `error.message`**, which is always “One or
  more fields are invalid”. The fields were in `details[]`. Running the tests
  caught it; the assertions now check `details[].field`.
- Homework 1’s lesson reused: **ground in `TASKS.md`, then verify by running**.

### ⚠️ Challenges and how they were handled

| Challenge | Resolution |
|---|---|
| **Context-Model-Prompt not defined in the repo** | Working definition + per-artifact log in `docs/ai-usage.md`; questions asked before implementation |
| **Classifier: LLM vs keywords** | Keywords — matches `keywords_found`, keeps tests deterministic |
| **CSV import vs Express JSON parser** | Global JSON middleware skips `POST /tickets/import`; a `text/csv` test pins it |
| **Port 3000 already in use** | `PORT=3456 ./demo/run.sh` (same pattern as homework 1) |
| **Coverage screenshot vs terminal reporter** | `docs/screenshots/coverage.html` mirrors the Node coverage table for a readable capture |

### 🔍 How to verify

```bash
cd gen-ai-software-engineering/homework-2
npm install
npm test                    # 57 tests, 57 passing
npm run test:coverage       # line coverage >85% (last run 91.27%)

npm run seed                # 50 classified tickets into data/tickets.db
PORT=3456 ./demo/run.sh     # http://localhost:3456  (API + agent UI)
```

Then:

```bash
open http://localhost:3456

curl -sS -X POST 'http://localhost:3456/tickets/import?auto_classify=true' \
  -H 'Content-Type: text/csv' \
  --data-binary @demo/sample_tickets.csv

curl 'http://localhost:3456/tickets?category=account_access&priority=urgent'
curl -sS -X POST http://localhost:3456/tickets/<id>/auto-classify
```

Full instructions: [`HOWTORUN.md`](HOWTORUN.md).  
API: [`docs/API_REFERENCE.md`](docs/API_REFERENCE.md).  
Coverage numbers: `docs/evidence/test-coverage.txt`.

### 📸 Screenshots

<!-- Drag the files from docs/screenshots/ onto these lines. -->

**1. Agent UI with real ticket data** (`TASKS.md` deliverable)

_(ui.png)_

**2. Test coverage >85%** (`TASKS.md` deliverable)

_(test_coverage.png)_ — also saved as `docs/screenshots/coverage.html`

**3. AI tool interaction (course README)**

_(ai-prompt.png)_

### ✅ Checklist

- [x] Tasks 1–6 implemented
- [x] SQLite persistence (`node:sqlite`), no extra native addon
- [x] `README.md`, `HOWTORUN.md`, API / architecture / testing docs
- [x] `.gitignore` excluding `node_modules/`, `.env`, `data/*.db`, coverage
- [x] `demo/run.sh`, sample CSV/JSON/XML (50/20/30), invalid files
- [x] AI / CMP usage documented (`docs/ai-usage.md`)
- [x] 57 automated tests, all passing, >85% line coverage
- [ ] Screenshots in `docs/screenshots/` (`ui.png`, `test_coverage.png`)
- [ ] Screenshots embedded in this PR body
- [ ] Reviewer assigned: **Alexey-Popov**; labels `homework-2`, `ready-for-review`
