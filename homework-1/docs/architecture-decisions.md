# Architecture decisions

Short records of the choices that shaped this codebase, why they were made, and
what the alternative would have cost. They are the answers to "why is it built
this way?" that a reviewer would otherwise have to reverse-engineer from the
code.

---

## 1. Layered modules instead of logic in the route handlers

**Decision.** Requests flow through four layers:

```
routes/        HTTP concerns only: read params, set status codes and headers
validators/    reject bad input, normalize good input
services/      derived read models (balance, summary, interest, CSV)
models/        the transaction record and the in-memory store
```

**Why.** Every requirement in the assignment lands in exactly one layer, so a
change has one obvious home: a new filter is a validator plus a store predicate,
a new derived endpoint is a service function. It also makes the interesting logic
(money arithmetic, date boundaries, balance derivation) testable without an HTTP
server — `tests/units.test.js` calls it directly.

**Alternative.** Everything in `src/index.js`. Faster to write for four
endpoints, but validation, money maths and routing end up interleaved, which is
precisely the code that later needs to be read carefully.

---

## 2. Money is stored as integer minor units

**Decision.** Amounts are converted to integer cents (`amountMinor`) on the way
in and back to decimals on the way out. All sums run on integers.

**Why.** Balances are sums of many amounts, and IEEE-754 floats do not sum
cleanly: `0.1 + 0.2 === 0.30000000000000004`. A balance endpoint that returns
`0.30000000000000004` is not acceptable, and rounding at the edge only hides the
drift. Integers make the arithmetic exact and rounding explicit.
`tests/units.test.js` pins this behaviour.

**Alternative.** A decimal library (`decimal.js`, `big.js`) — more capable, but
an extra dependency for a two-decimal domain that integers already handle.

---

## 3. Every figure is reported per currency

**Decision.** `GET /accounts/:id/balance` returns a `balances` array with one
entry per currency. Summary totals are per currency. Interest requires
`?currency=` when an account holds more than one.

**Why.** Adding 100 USD to 100 EUR produces a number that means nothing. Real
core-banking APIs (Qonto, Solaris) attach a currency to every amount and never
aggregate across currencies; a demo API that silently sums them would be teaching
the wrong lesson. The trade-off is a slightly larger response than
`{"balance": 100}` and one extra parameter on the interest endpoint, which is why
`?currency=` also exists as a shortcut for the single-currency case.

**Alternative.** Assume one currency per account. Simpler responses, but the
assumption is invisible to the client and wrong as soon as two currencies appear.

---

## 4. Only `completed` transactions move money

**Decision.** Balance, summary totals and interest are computed from `completed`
transactions. `pending` and `failed` ones are stored, listed and filterable, and
the summary reports them under `statusBreakdown`.

**Why.** `status` is part of the required model, so it has to mean something. A
pending transfer has not settled and a failed one never will; counting either
would overstate the balance. Reporting the excluded counts keeps the number
explainable — a client can see *why* the balance differs from the transaction
list.

---

## 5. Account existence is derived from the ledger

**Decision.** There is no account resource. An account exists once a transaction
references it; otherwise the account endpoints return `404`.

**Why.** The assignment specifies no account creation endpoint, and inventing one
would widen the scope. Deriving existence from the ledger keeps the required
`404` meaningful (`ACC-99999` is genuinely unknown) without adding a second
resource to maintain.

**Consequence.** An account whose only transaction is pending exists but has an
empty `balances` array — documented in the API reference.

---

## 6. Account fields are validated per transaction type

**Decision.** `deposit` requires `toAccount` and forbids `fromAccount`,
`withdrawal` is the mirror image, `transfer` requires both and they must differ.
Violations are `400`, not ignored fields.

**Why.** The two account fields are the only inputs to the balance arithmetic. A
deposit that also carries a `fromAccount` is ambiguous — it could mean a transfer
— and guessing would risk mis-stating a balance. This is the one place where
strictness beats leniency, so the error messages say exactly what to do
("`fromAccount` must be omitted for deposit transactions (funds originate outside
the ledger)").

---

## 7. Validation collects all errors before responding

**Decision.** A `ValidationErrorBag` accumulates field errors; the request fails
once with every problem listed in `details`.

**Why.** The response shape required by the assignment is an *array* of details,
which only pays off if it is actually populated. Fixing a payload one field per
round trip is the most common annoyance in hand-rolled APIs.

---

## 8. Strict input, lenient about extras

**Decision.** Known fields and parameters are validated strictly; unknown body
fields and unknown query parameters are ignored. A repeated query parameter is
rejected.

**Why.** Ignoring unknown fields is what keeps clients forward-compatible — this
is the rule Solaris' "Requests and responses" page states, and Express hands
repeated parameters over as arrays, which would silently turn `?type=a&type=b`
into a nonsensical filter. Rejecting the ambiguous case while ignoring the
harmless one is the combination that produces the fewest surprises.

---

## 9. Filter dates are inclusive whole days

**Decision.** `?from=2024-01-01&to=2024-01-31` covers `2024-01-01T00:00:00.000Z`
through `2024-01-31T23:59:59.999Z`; full ISO 8601 datetimes are used verbatim.

**Why.** The assignment's example uses bare dates. Treating `to=2024-01-31` as
midnight would silently drop a whole day of transactions — the classic
off-by-one-day reporting bug. Both interpretations are supported explicitly and
covered by tests.

---

## 10. The app is created by a factory, not a module singleton

**Decision.** `createApp({ store, rateLimit })` builds the Express app;
`src/index.js` only handles process concerns (port, seeding, signals, exit
codes).

**Why.** Tests start the real app on an ephemeral port with its own store, so no
test sees another's transactions and the rate limiter can be configured per test
(`max: 3` to prove the `429`) without a shared 100-request budget. It also keeps
`supertest` out of the dependency list — `fetch` against a real server is enough.

---

## 11. Fixed-window rate limiting, in memory

**Decision.** A `Map` of IP → `{ count, resetAt }`, 100 requests per 60 seconds,
configurable via `RATE_LIMIT_*`, with `X-RateLimit-*` headers on every response
and `Retry-After` on `429`.

**Why.** It is the simplest algorithm that satisfies the requirement, needs no
dependency and no timers (windows are pruned lazily). The trade-off is the
boundary effect: a client can send up to 200 requests across two adjacent
windows. A sliding window or token bucket would smooth that out at the cost of
more state — not worth it for an in-memory demo, and the limiter is switchable
(`RATE_LIMIT_ENABLED=false`) so it never gets in the way of a demo.

---

## 12. Express 5 with one dependency

**Decision.** `express` is the only runtime dependency; tests use the built-in
`node:test` runner and `fetch`.

**Why.** Express is what the assignment's example structure implies, and Express 5
forwards errors thrown in handlers (including async ones) to the error middleware,
which is what lets route handlers simply `throw new NotFoundError(...)`. Keeping
`node_modules` to one direct dependency means `npm install` is fast and the
project still runs years from now.

---

## 13. One JSON error renderer

**Decision.** A single `errorHandler` middleware renders every failure. Known
failures are `ApiError` subclasses; body-parser failures are translated; anything
else is logged with its stack and returned as a generic `500`.

**Why.** Without it Express answers a thrown error with an HTML stack trace,
which breaks JSON clients and leaks internals. Centralising it also means the
response shape is defined in exactly one place, so it cannot drift between
endpoints.
