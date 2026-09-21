# AI-assisted development log

How this homework was actually built, which prompts drove it, what the AI got
wrong, and what was verified by running it rather than by reading it.

| | |
|---|---|
| **Primary tool** | Claude Code (VS Code extension) — produced this implementation |
| **Model** | Claude Opus 5 |
| **Also used** | Cursor, run in parallel on the same brief (see [section 8](#8-two-tools-same-brief-run-in-parallel)) |
| **Session date** | 9 September 2026 |
| **Author / reviewer** | Simone Benevelli |
| **Repository** | `gen-ai-software-engineering/homework-1` |

> Screenshots of the session are in [`screenshots/`](screenshots/) —
> [`screenshots/README.md`](screenshots/README.md) lists the three `TASKS.md`
> asks for and what is visible in each.

---

## 1. The prompt that started it

> go through the homework and complete it. Make sure all tasks are covered,
> especially the ones marked as required. Follow the project structure and the
> tips for success. Use Solaris/Qonto documentation products as inspiration,
> since they treat Core APIs as well. Ask questions where needed

Three things in that prompt did most of the work:

1. **"especially the ones marked as required"** — anchored the plan to
   `TASKS.md` instead of to a generic "build a REST API" template.
2. **"Use Solaris/Qonto documentation products as inspiration"** — gave the
   documentation a concrete reference point (see step 2).
3. **"Ask questions where needed"** — explicitly licensed the model to stop and
   ask instead of guessing. This is what produced the four decisions below, and
   it is the single most useful sentence to keep in a prompt of this size.

## 2. Grounding before generating

The model did **not** write the docs from memory of how Qonto and Solaris work.
It fetched the live pages first:

- `docs.qonto.com/get-started/general/pagination.md`
- `docs.qonto.com/get-started/general/errors.md`
- `docs.qonto.com/get-started/general/idempotent-requests.md`
- `docs.qonto.com/get-started/general/rate-limitations.md`
- `docs.qonto.com/get-started/general/versioning.md`
- `docs.qonto.com/api-reference/business-api/.../list-transactions.md`
- `docs.solarisgroup.com/api-reference/requests-and-responses/`

What that changed concretely: the **"Standards" section before the endpoint list**
(both providers document conventions first), the explicit
**"unknown parameters are ignored"** rule (Solaris states it), **inclusive
whole-day date filters**, per-currency amounts, and the `X-RateLimit-*` /
`Retry-After` behaviour on `429`. Conventions that belong to a paid platform and
not to this assignment — URL versioning, `{data, meta}` envelopes, idempotency
keys, API-key auth — were deliberately left out (see step 3).

**Lesson worth reusing:** when a prompt names a real product as inspiration, make
the assistant read that product's docs. "Inspired by" from memory produces
plausible-sounding conventions that the real product does not use.

## 3. Four questions asked before any code was written

| Question | Answer chosen | Effect |
|---|---|---|
| Stack? | Node.js + Express | Matches the example structure and port 3000 in `TASKS.md` |
| How many Task 4 options? | **All four** | Summary, interest, CSV export and rate limiting are all implemented |
| How much Qonto/Solaris platform polish on the wire? | **Keep the API plain** | Flat JSON arrays, the exact error shape from `TASKS.md`, no `/v1` prefix or envelopes — the Solaris/Qonto influence went into `docs/api-reference.md` instead |
| Screenshots? | Capture script + checklist | `demo/capture-evidence.sh` records real transcripts; the human still takes the screenshots |

The third answer mattered most: it is the difference between "implements the
assignment" and "implements a different, fancier API than the one asked for".
Asking rather than assuming avoided a rewrite.

## 4. Build order, and why it was bottom-up

Layer by layer, each layer smoke-tested with a one-line `node -e` before the next
was written:

```
utils (money, currencies, dates, accounts, errors)
  -> models (transaction record, in-memory store)
    -> validators (body, filters, params)
      -> services (balance, summary, interest, CSV)
        -> middleware (rate limit, logging, JSON guard, 404, error renderer)
          -> routes -> app factory -> process bootstrap
```

Generating the whole app in one pass is the tempting prompt, but a single wrong
assumption then hides inside 600 lines. Building bottom-up meant the money
arithmetic was proven correct (`toMinorUnits(100.5, 'USD') === 10050`) before
anything depended on it.

## 5. Where the AI was wrong, and how it was caught

**A garbled expression in the interest calculation.** The first draft of
`getSimpleInterest` contained this line:

```js
const principalMinor = balance
  ? Math.round(balance.balance * 10 ** String(balance.balance).length * 0) + toMinor(balance, selected)
  : 0;
```

`* 0` makes the first term dead, so the code "worked", and a
`require()` inside a helper at the bottom of the file hid the real intent. It was
leftover from an aborted attempt to recover minor units from an
already-formatted balance. Reading the generated code — rather than only checking
that the endpoint returned a number — caught it. The fix was structural: an
internal `balanceBucketsFor()` that keeps minor units, so the service never has
to reverse a formatted amount. **This is the concrete case for the "read AI
output" tip: the test would have passed either way.**

**`node --test tests/` does not work on Node 24.** The generated npm script
failed with `Cannot find module '.../tests'`. Fixed by using the glob form,
`node --test "tests/**/*.test.js"`, which Node expands itself. A generated
command that "looks right" still has to be run.

**Route ordering.** `GET /transactions/export` must be registered *before*
`GET /transactions/:id`, otherwise `export` is parsed as a transaction id and the
export endpoint answers `404`. The model got this right on the first pass and
added a comment, but a regression test (`tests/export.test.js` → "the export
route is not shadowed by GET /transactions/:id") now pins it, because it is
exactly the kind of thing a later refactor silently breaks.

## 6. What was verified by running it

| Check | Result |
|---|---|
| `npm test` | **77 tests, 77 passing** (`docs/evidence/test-output.txt`) |
| `./demo/capture-evidence.sh` | 31 recorded requests, all with the expected status codes (`docs/evidence/api-transcript.txt`) |
| Every example in `docs/api-reference.md` | Re-run against a freshly seeded server and pasted from the real response — no invented payloads |
| Rate limiting | Verified end to end with `RATE_LIMIT_MAX=5` and `./demo/sample-requests.sh --rate-limit`: `429` with `Retry-After` |
| Postman collection | Not hand-written from memory: the collection schema was checked against the real thing, then the file was **executed** with `newman` — 37/37 requests and assertions passing |
| Float precision | `0.1 + 0.1 + 0.1` deposits produce a balance of exactly `0.3` |

## 7. Prompts worth keeping

- *"Ask questions where needed"* — for anything larger than a single function,
  this is what turns a guess into a decision.
- *"Use <real product> documentation as inspiration"* + letting the tool fetch
  the actual pages — grounded conventions instead of plausible ones.
- *"Make sure all tasks are covered, especially the ones marked as required"* —
  keeps a multi-part assignment from losing its optional-looking parts; the model
  tracked `TASKS.md` item by item.
- Asking for **one layer at a time** and running it before continuing.
- Asking *why* a piece of generated code exists. The dead `* 0` expression
  survived a working endpoint; it did not survive being explained.
- For a generated *file format* (a Postman collection, a CI config), ask for the
  schema to be read from source and the file to be run through the real tool. An
  import that silently drops half a collection is not something reading the JSON
  would reveal.

## 8. Two tools, same brief, run in parallel

The assignment was given to **two** assistants at the same time:

| Tool | Role |
|---|---|
| **Claude Code** (VS Code extension, Opus 5) | Produced the implementation in this branch |
| **Cursor** | Given the same `TASKS.md` in parallel, as a second take on the same problem |

Running both against one brief is what made the differences legible — a single
tool's output always looks reasonable until you have something to compare it
against. The header table at the top of this document lists Claude Code as the
primary tool because every file here came from that session; Cursor's run served
as the control.

What that comparison surfaced from the Claude Code side, and what is worth
carrying into the next assignment:

- **Clarifying questions before code changed the outcome more than code quality
  did.** The four questions in [step 3](#3-four-questions-asked-before-any-code-was-written)
  — especially "how much Qonto/Solaris convention on the wire?" — decided the
  shape of the whole submission. A tool that starts typing immediately produces
  working code just as fast; it just answers a slightly different question than
  the one the assignment asked.
- **Grounding beats recall.** Fetching the live Qonto and Solaris pages
  ([step 2](#2-grounding-before-generating)) produced conventions that match the
  real products. Anything written from memory of those APIs would have sounded
  equally plausible and been unverifiable.
- **Verification is the part worth demanding.** 77 tests, a 31-request
  transcript, and a Postman collection executed through `newman` are what turn
  "it works" into something a reviewer can check in one command.

