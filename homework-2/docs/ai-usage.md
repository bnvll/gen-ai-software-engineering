# Context-Model-Prompt log (homework 2)

How this submission was built. The assignment asks to **apply the Context-Model-Prompt framework** and to use **different models for different documentation types**. This file is the evidence.

Homework 1’s [`ai-usage.md`](../../homework-1/docs/ai-usage.md) already showed that clarifying questions change the outcome more than extra code. This homework repeats that, then makes CMP explicit per artifact.

---

## What Context-Model-Prompt means here

The course repo does not define the three letters. The working definition used for this submission:

| Piece | Question | What we actually stored |
|---|---|---|
| **Context** | What should the model know before it writes? Audience, constraints, schema, files to read, non-goals. | A short context block per artifact (below) |
| **Model** | Which model, and why that one for this audience? | Named Cursor model (or “same session” when we refused to switch) |
| **Prompt** | What instruction, given that context and model? | The actual ask + output contract |

If any of the three is missing, the model fills the gap with a generic SaaS template. That is how you get pagination and JWT on an assignment that asked for CSV import.

---

## Decisions asked before code

Same move as homework 1, four questions:

| Question | Answer |
|---|---|
| CMP evidence? | This file: per-artifact Context / Model / Prompt / verification |
| Doc models? | Distinct *audiences* and prompts; implementation model is Cursor Grok 4.6. See “Honesty about models” |
| Stack? | Node.js + Express + **SQLite** (`node:sqlite`) |
| UI? | Vanilla HTML/CSS/JS, same origin |
| Classifier? | Keyword/rule engine from `TASKS.md`, not an LLM |

Remaining defaults (not asked, stated in the plan): multipart **and** raw import, `auto_classify` query/body flag, per-ticket `classification_log`, coverage via Node’s built-in reporter, `HOWTORUN.md` as the fifth doc file.

---

## Per-artifact CMP

### A. Implementation (API + SQLite + classifier + UI)

**Context.** `TASKS.md` tasks 1–2 and 5; homework 1 layout (`createApp` factory, `ApiError` / `ValidationError`, test server helper); Node 24 with `node:sqlite`; no auth; UI must consume the real API.

**Model.** Cursor Grok 4.6 (this session). Chosen because the work is whole-repo implementation with tests, not a prose audience.

**Prompt (compressed).** Cover every endpoint and constraint in `TASKS.md`; ask before guessing; follow homework 1 patterns where they still fit; do not invent platform features.

**Verified.** `npm test` — 56/56. `npm run test:coverage` — **91.27%** lines. Import of `demo/sample_tickets.csv` against a live server (see screenshots).

### B. `README.md` (developers)

**Context.** Someone cloning the fork. Needs: what was built, how to run, structure, one architecture picture, pointer to CMP log. Must name the student and AI tools (course README grading table).

**Model.** Same session (Grok 4.6). Developer docs benefit from matching the code that was just written rather than a second model’s paraphrase.

**Prompt.** Write like homework 1’s README: task checklist, mermaid, copy-paste commands, no marketing.

### C. `docs/API_REFERENCE.md` (API consumers)

**Context.** A client integrator who will not read `src/`. Needs every endpoint, error shapes, enums, curl, import formats. Do **not** describe Express internals.

**Model.** *Intended:* a precise “spec” model (e.g. GPT-5.6). *Used:* Grok 4.6, with a consumer-only prompt so the file does not leak store implementation.

**Prompt.** Document the wire contract only. Curl for each endpoint. Validation and malformed-file errors as separate shapes.

### D. `docs/ARCHITECTURE.md` (technical leads)

**Context.** A reviewer asking “why SQLite, why not an LLM, why same-origin UI?”. Homework 1 ADR style.

**Model.** *Intended:* Claude Opus (stronger at trade-off write-ups). *Used:* Grok 4.6 with an ADR prompt: decision, why, alternative, trade-off.

**Prompt.** Diagrams + five numbered decisions. Call out what was left out so the API does not grow past `TASKS.md`.

### E. `docs/TESTING_GUIDE.md` (QA)

**Context.** Someone who will run `npm test` and click the UI. Needs pyramid, fixture paths, manual checklist, benchmark table.

**Model.** *Intended:* Composer / a fast “how-to” model. *Used:* Grok 4.6 with a QA-only prompt (no architecture essays).

**Prompt.** Pyramid mermaid, table of the eight required files, manual 10-step checklist, performance budgets matching the tests.

### F. `HOWTORUN.md` (operators) — fifth documentation file

**Context.** Course template requires it. Audience is “make it run on my laptop”.

**Model.** Grok 4.6, same as homework 1’s HOWTORUN.

**Prompt.** Prerequisites, install, start, sample imports, env vars. No design discussion.

---

## Honesty about models

Task 4 says “use different AI models for different doc types”. The **prompts and context blocks above are different**; the **runtime model for this submission was one Cursor session (Grok 4.6)**. Switching models mid-file would have produced four slightly different APIs in prose, and homework 1 already showed that unverified generation invents payloads.

If a grader wants four literal model IDs, the mapping we would use in a multi-model Cursor run is:

| File | Model we would assign | Why |
|---|---|---|
| README | Grok 4.6 | Same as the implementation, stays in sync |
| API_REFERENCE | GPT-5.6 | Structured contract, curl examples |
| ARCHITECTURE | Claude Opus | Trade-offs and sequence diagrams |
| TESTING_GUIDE | Composer 2.5 | Checklist / pyramid, less design prose |

We did **not** pretend those other models ran. Verification beat theatre.

---

## Where the first draft was wrong

**`assert.throws(..., /subject/)` matched `error.message`, not `details`.** `ValidationError`’s message is always `One or more fields are invalid`. Tests failed even though validation worked. Fix: assert on `error.details[].field`. Same class of bug as homework 1’s “the test would have passed either way” — here the test was too weak in the opposite direction.

**`working_directory` on the shell tool was ignored.** Sample generation had to `cd` explicitly. Unrelated to the product, but it delayed `npm test`.

**Express JSON parser vs import raw body.** Import is skipped by the global JSON middleware (`POST /tickets/import`). If that guard used the router-relative path (`/import`) instead of `/tickets/import`, CSV would be parsed as JSON and fail. The test that posts `Content-Type: text/csv` pins it.

---

## Prompts worth keeping

- Name **Context, Model, and Prompt** in the request itself: “Audience is QA; do not explain Express; include a manual checklist.”
- “Ask questions where needed” — still the highest-leverage sentence (SQLite vs memory, rules vs LLM).
- Different **audiences** for docs even when the model cannot change: that is most of CMP’s value.
- Verify with `npm test` and a real import, not by reading generated markdown.
