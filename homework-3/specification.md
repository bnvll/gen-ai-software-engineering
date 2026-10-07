# Virtual Card Lifecycle Specification

> Ingest this file, implement the Low-Level Tasks in order, and generate only the code that satisfies the High-Level Objective and the Mid-Level Objectives. If a task conflicts with Implementation Notes, Non-Functional & Policy, or the edge-case table, stop and follow those sections.

**Service:** Harbor virtual cards (`services/virtual-cards`)
**Market (v1):** one retail bank, one currency (EUR), one open virtual debit card per funding account
**This document is the product contract.** Numbers in [Expected performance](#expected-performance) are **assumed targets**.

---

## High-Level Objective

A KYC-complete cardholder can issue one virtual debit card on their EUR funding account, freeze and unfreeze it themselves, set a monthly spend limit, and read that card’s transactions, while compliance can independently hold the card and reconstruct every state change from an append-only audit log.

**Scope boundary:** this service owns card lifecycle, card-level spend control, and the authorization *decision* the issuer processor asks for. It does not own KYC, the funding-account ledger, scheme connectivity, 3-D Secure challenges, physical cards, PIN, ATM, credit, disputes, or multi-currency.

---

## Stakeholders

| Actor | Role token | What they can observe |
|---|---|---|
| Cardholder | `cardholder` | Own card, masked details, own freeze flag, own limit, own posted and pending transactions |
| Support agent | `support` | Any card’s masked state and transactions; can set and clear only the `support` freeze flag |
| Compliance officer | `compliance` | Any card, full freeze breakdown, audit search for the retention window |
| Fraud service | `fraud_service` | Machine client. Sets and clears only the `fraud` freeze flag. No read API in v1 |
| Issuer processor | `issuer_processor` | mTLS client. Asks for authorization decisions and submits reversals and clearings |

The cardholder API collapses `compliance` and `fraud` into a single `bank: true` flag. Support sees that same `bank` bit and cannot clear it. Only `compliance` sees the separate flags.

---

## Mid-Level Objectives

Each objective is met only when the observable outcome is true in a running system, not when the code merely exists.

### M1 — Issue one open card

A cardholder with a recent strong-customer-authentication (SCA) session can create a virtual card for a funding account they own. The account has at most one **open** card (`pending_issuer` or `active`). The successful response is masked: last four digits, expiry, limit, and status. The primary account number (PAN) and card verification value (CVV) are absent. A second create against the same account returns `422 card_already_open` and does not call the issuer. Replaying the same `Idempotency-Key` returns the original result and does not create a second card.

### M2 — Freeze is immediate and reversible only by the actor who placed it

A cardholder can freeze and unfreeze their own card. While any freeze flag is set, the authorization endpoint declines with `card_frozen`. After a freeze commit, a following authorization decision sees that flag (read-your-writes; see [NFR-PERF](#nfr-perf--assumed-targets)). Clearing the cardholder flag does not clear a support, compliance, or fraud flag. The cardholder then still sees the card as frozen by the bank or by support.

### M3 — A monthly limit is enforced on the authorization path

The cardholder can set a monthly limit between **10.00** and **5000.00** EUR. The default at issue is **500.00**. Approved authorizations, minus reversals, count toward the calendar month in `Europe/Rome`. An authorization that would exceed the remaining amount is declined with `limit_exceeded` and does not move the meter. Lowering the limit below spend already approved this month succeeds; later authorizations decline until the next month or until a reversal frees budget.

### M4 — The cardholder can read transactions without guessing pagination

`GET /v1/cards/:cardId/transactions` returns pending and posted purchases for that card, newest first, page size default 20 and maximum 100. An empty card returns `200` with `data: []`. A purchase accepted by the authorization endpoint appears on the next list call (primary read). A clearing accepted with `2xx` shows as `posted` on the next list call. Declines and reversals are omitted from the cardholder list.

### M5 — Compliance can hold the card and reconstruct history

A compliance officer can place a hold the cardholder cannot lift, and can release only that hold. Every mutation writes one append-only audit event with actor, action, prior state, new state, and correlation id. Compliance can query those events by customer, card, and time range. Support cannot release a bank hold. Database grants for the application role do not include `UPDATE` or `DELETE` on the audit table.

### M6 — Secrets stay out of storage and logs

This service does not store PAN or CVV at rest. It stores the issuer’s card token, last four, and expiry. Reveal requires SCA within the last 300 seconds, returns PAN and CVV once in the response body, writes `pan_revealed` to the audit log **without** the secret, and the logger drops PAN-shaped digits, CVV fields, and `Authorization` headers. A cardholder who presents another customer’s card id receives `404`, same as an unknown id.

---

## Non-Functional & Policy

### NFR-SEC — Security

- Cardholder and staff routes require a gateway-validated OAuth2 bearer token. This service trusts `customer_id`, `role`, and `sca_at` only from headers the gateway sets (`X-Customer-Id`, `X-Actor-Role`, `X-Sca-At`). Client-supplied copies of those headers are stripped at the gateway. Document that assumption in `docs/trust-boundary.md` when implementing.
- Issuer routes require mutual TLS. They do not accept bearer tokens.
- Object-level authorization: a cardholder query whose `card_id` is missing **or** owned by someone else is `404 card_not_found`. Staff roles may read any card. Wrong role on an existing route is `403`.
- Reveal calls `IdentityPort.assertRecentSca` and requires `sca_at` within 300 seconds.
- Application database role: `SELECT/INSERT/UPDATE` on card, meter, idempotency, and transaction tables; `SELECT/INSERT` only on `card_audit_events`.

### NFR-PRIV — Privacy

- Persisted card row: `issuer_card_token`, `last4`, `expiry_month`, `expiry_year`. No PAN, no CVV, no full track.
- Audit and logs may store last4. They must not store PAN, CVV, or the reveal response body.
- Merchant name on a transaction is truncated to 80 characters and rejected (stored as `"redacted"`) if it matches a PAN-shaped run of 13–19 digits.
- Retention, **assumed policy** for an EU retail bank and not a legal opinion: audit events **7 years**; card and transaction rows **7 years** after close; idempotency keys **24 hours**; application logs **30 days**.

### NFR-AUD — Audit

Each successful or rejected **business** mutation appends one event. Rejections that are authentication failures are logs only, not audit rows. The event fields are listed under [Audit event](#audit-event). Events are immutable. A correction is a new event.

### NFR-REL — Reliability

- Issue uses a local saga, not a distributed transaction. Order: insert `pending_issuer` and the idempotency row in one database transaction, then call the issuer, then mark `active` or `issue_failed`.
- Issuer timeout or HTTP 5xx leaves the card `pending_issuer` and returns `202`. The same idempotency key re-drives the call. A reconciler retries `pending_issuer` rows older than 30 seconds.
- Authorization decisions and meter updates commit in one database transaction under a row lock. A process crash mid-decision must not leave an approved meter increment without a decision row, or the reverse.
- Issuer create is retried only with the same idempotency key the processor was given (`card_id`). A timeout must not mint a second processor card.

### NFR-PERF — Assumed targets

| Operation | Assumed target | Why this is reasonable |
|---|---|---|
| `POST /v1/cards` (issuer healthy) | p95 ≤ 800 ms, p99 ≤ 2 s | One outbound issuer call dominates. Issuing is rare; sub-second p95 matches typical virtual-card UX |
| Freeze, unfreeze, set limit | p95 ≤ 150 ms, p99 ≤ 400 ms | Local write. The cardholder is often locking a lost phone and will retry if it feels hung |
| `GET /v1/cards/:id` | p95 ≤ 80 ms | First screen of the card page |
| Transaction list, page ≤ 50 | p95 ≤ 200 ms | Mobile list, primary-key lookup plus one index range |
| Authorization decision | p95 ≤ 100 ms, p99 ≤ 250 ms | Sits inside the processor’s scheme budget (often 1–2 s end to end). This slice must stay a small fraction |
| Freeze visible to the next decision | ≤ 1 s p99 after commit | Same primary database, no freeze-flag cache. A lost-card freeze that authorizations ignore for many seconds is a control failure |
| Audit search, 31-day window, page ≤ 50 | p95 ≤ 500 ms | Ops UI, off the payment path |
| Availability of decision and freeze | 99.9% monthly | **Assumed** control-plane target. Issue may be lower; it is not on the purchase path |

Read-your-writes for card GET, transaction list, and authorization decision: those queries use the primary, not a replica. Clearing *arrival* from the scheme is outside this SLO. Once this service has returned `2xx` for a clearing, the next list shows `posted`.

**Rate limits (assumed):**

| Caller | Limit | On breach |
|---|---|---|
| Cardholder mutations | 10 requests / minute / customer | `429` + `Retry-After` |
| Cardholder reads | 120 requests / minute / customer | `429` + `Retry-After` |
| Reveal | 3 requests / hour / card | `429`, and audit `reveal_velocity` when the hour cap is hit |
| Issuer authorizations | 50 rps sustained per card, burst 100 | `429` to the processor; do not decline the purchase as `limit_exceeded` |

Pagination: default `limit=20`, maximum `100`. A larger `limit` is `400 invalid_page_size`.

Idempotency-Key retention: **24 hours**. After that, a replay is a new request and is subject to the “one open card” rule.

---

## Implementation Notes

These are guardrails. An implementer does not invent alternatives.

### Money

- Domain, database, and the authorization meter use **integer minor units** (euro cents), type `bigint`, always ≥ 0 except where a reversal amount is a positive magnitude applied as a subtraction.
- JSON request and response amounts are **decimal strings** with exactly two fraction digits (`"500.00"`). Parse by splitting on `.` and checking both sides. Do not use binary floating point and do not use `Number` for arithmetic.
- Currency is `EUR` only in v1. Any other currency is `422 currency_not_supported` on cardholder routes and decision reason `currency_not_supported` on the issuer route.
- The smallest authorization amount is 1 cent. Zero or negative is a decline reason `amount_invalid` (issuer route) or `400 amount_invalid` (cardholder route).

### Identifiers

| Entity | Format | Example shape |
|---|---|---|
| Card | `card_` + ULID | `card_01J0A2B3C4D5E6F7G8H9JKMNPQ` |
| Customer, account | Provided by upstream, `cus_` / `acc_` + ULID | Reject otherwise |
| Transaction | `txn_` + ULID | Assigned by this service |
| Audit | `aud_` + ULID | Assigned by this service |
| Idempotency-Key | 8–64 chars, `[A-Za-z0-9_-]` | Client-supplied on every mutation |

ULIDs are Crockford base32. Generate them in the application, not in the database, so the idempotency row and the card row share the id before commit.

### Card record

Stored columns (logical): `id`, `customer_id`, `funding_account_id`, `status` (`pending_issuer` \| `active` \| `closed` \| `issue_failed`), `freeze_user`, `freeze_support`, `freeze_compliance`, `freeze_fraud` (booleans), `monthly_limit_cents`, `expiry_month`, `expiry_year`, `last4`, `issuer_card_token`, `version`, `created_at`, `updated_at`, `closed_at`.

Partial unique index: one row per `funding_account_id` where `status in ('pending_issuer', 'active')`.

`version` starts at 1 and increments on every mutation. Cardholder and staff mutations send `expected_version`. A mismatch returns `409 version_conflict` with the current masked resource. The issuer authorization path does **not** use `expected_version`; it takes `SELECT … FOR UPDATE` on the card row.

### Display status

Derived, never stored:

1. `issue_failed` or `pending_issuer` or `closed` → that status
2. else if any freeze flag → `frozen`
3. else if the expiry month is strictly before the current `Europe/Rome` month → `expired`
4. else → `active`

Cardholder `freeze` object: `{ "user": bool, "support": bool, "bank": bool }` where `bank = freeze_compliance OR freeze_fraud`. Compliance GET adds `compliance` and `fraud` booleans. Do not add those keys to the cardholder JSON.

### Freeze rules

| Actor | May set | May clear |
|---|---|---|
| `cardholder` | `freeze_user` on own card | `freeze_user` on own card |
| `support` | `freeze_support` | `freeze_support` |
| `compliance` | `freeze_compliance` | `freeze_compliance` |
| `fraud_service` | `freeze_fraud` | `freeze_fraud` |

Setting a flag that is already set returns `200` with the current resource and writes no second audit event (idempotent no-op). Clearing a flag that is already clear is the same. A cardholder unfreeze that clears `user` while another flag remains returns `200`, `display_status: "frozen"`, and the remaining public flags. It is not an error.

Closing a card (`POST /v1/cards/:id/close`) is allowed when stored `status` is `active`, including when freeze flags are set. Display status `frozen` does not block close. Close sets `status=closed`, leaves flag columns as they were, and rejects further freeze, limit, reveal, and authorization. Close is idempotent when already closed.

### Limit window

- Time zone: `Europe/Rome`. Stored timestamps are `timestamptz` UTC.
- Window: `[start of calendar month, start of next calendar month)` in that zone.
- Meter = sum of approved authorization amounts in the window, minus reversals, with clearings **replacing** the original auth amount when they arrive (a 20.00 auth cleared as 18.50 moves the meter down by 1.50).
- Two authorizations for the same card serialize on the card row lock.
- Default limit `50000` cents. Bounds inclusive: `1000` … `500000` cents.

### Authorization decision

`POST /v1/issuer/authorizations` returns **HTTP 200** for both approve and business decline. The processor must be able to tell a processed decline from a platform failure.

Decline precedence:

1. Unknown `issuer_card_token` → `200` `{ "decision": "declined", "reason": "card_not_found" }`
2. `pending_issuer` or `issue_failed` → `card_not_active`
3. `closed` → `card_closed`
4. Expired → `card_expired`
5. Any freeze flag → `card_frozen`
6. Currency not EUR → `currency_not_supported`
7. Amount &lt; 1 cent → `amount_invalid`
8. Meter + amount &gt; limit → `limit_exceeded`
9. Else `approved`, insert decision, increment meter

The same `issuer_auth_id` with the same token, amount, and currency returns the original decision and does not move the meter again. The same id with a different amount or currency returns `409 idempotency_conflict`.

### Issue saga

1. Reject if the customer does not own `funding_account_id` (`IdentityPort` / accounts port says no → `404` as `account_not_found`, to avoid confirming other people’s account ids).
2. Reject if an open card exists (`422 card_already_open`).
3. Insert card `pending_issuer` + idempotency row.
4. Call `IssuerPort.createVirtualCard({ cardId, customerId, currency: "EUR" })`.
5. Success → `active`, store token, last4, expiry, audit `card_issued`, `201`.
6. Processor business rejection → `issue_failed`, audit `card_issue_failed`, `422 issuer_rejected`.
7. Timeout or 5xx → leave `pending_issuer`, audit `card_issue_pending`, `202` with the card id and `display_status: "pending_issuer"`.

### Errors

Use `application/problem+json` (RFC 9457) for cardholder and staff routes:

```json
{
  "type": "https://api.harbor.example/problems/limit-out-of-range",
  "title": "Limit out of range",
  "status": 422,
  "code": "limit_out_of_range",
  "detail": "Monthly limit must be between 10.00 and 5000.00 EUR.",
  "instance": "/v1/cards/card_01J/limit",
  "correlation_id": "req_01J"
}
```

`code` is stable snake_case. `detail` may be shown to the cardholder and must not contain PAN, CVV, SQL, stack traces, or other customers’ ids. `correlation_id` comes from `X-Request-Id` or is generated.

| HTTP | When |
|---|---|
| 201 | Issue completed (`active`) |
| 202 | Issue saved, issuer not confirmed |
| 200 | Reads, freeze, unfreeze, limit, close, and issuer decisions |
| 400 | Malformed JSON, bad amount format, bad cursor, bad idempotency key |
| 401 | Missing/invalid credentials |
| 403 | Authenticated but wrong role, or SCA too old |
| 404 | Card or account not visible to this actor |
| 409 | `version_conflict` or `idempotency_conflict` |
| 422 | Business rule (`card_already_open`, `limit_out_of_range`, `issuer_rejected`, illegal transition) |
| 429 | Rate limit |
| 503 | Database unavailable, or issuer timeout **before** the pending row could commit |

### Idempotency

Required on: issue, freeze, unfreeze, limit, close, compliance hold, compliance release, fraud hold, fraud release, reveal. Header name: `Idempotency-Key`.

Store `key`, actor id, `method`, `path`, request hash, response status, response body, `created_at`. Same key + same hash → replay the stored response, except reveal. Same key + different hash → `409 idempotency_conflict`. Keys are scoped to the actor, not global.

Reveal is the exception to stored bodies. The idempotency row for a successful reveal stores status `200` and the body `{"redacted":true}` — never PAN or CVV. Replaying that key does not call the issuer again and does not return the secret; it returns `409 reveal_not_replayable`. The client must send a new key and pass SCA again. This is EC-39.

### Audit event

`id`, `card_id`, `customer_id`, `actor_role`, `actor_id`, `action`, `from_public_status`, `to_public_status`, `reason_code` (nullable), `correlation_id`, `idempotency_key` (nullable), `created_at`.

Actions: `card_issued`, `card_issue_pending`, `card_issue_failed`, `freeze_set`, `freeze_cleared`, `limit_changed`, `card_closed`, `pan_revealed`, `authorization_approved`, `authorization_declined`, `authorization_reversed`, `clearing_posted`, `reveal_velocity`, `spend_after_limit_increase`.

`authorization_*` events store amount in cents and reason code, not merchant PAN-like strings.

### Fraud-ish signals (v1 does not auto-decline these)

- Reveal hits the hourly cap → `429` plus audit `reveal_velocity`. Do not freeze; a traveler retrying Apple Pay should not lose the card.
- Limit increases by more than 2× and an approval within 10 minutes uses more than 80% of the new limit → **approve** (the row lock already enforces the limit) and audit `spend_after_limit_increase`. v1 has no case tool to undo a false block quickly.
- Three or more user freeze/unfreeze cycles in one hour → allow, audit `freeze_churn`.

### Out of scope (do not implement as part of these tasks)

KYC onboarding, account opening, ledger balances, scheme ISO 8583 parsing, 3-D Secure, physical card, PIN, ATM, credit line, installment, dispute intake, chargeback, statements PDF, push notifications, multi-currency, wallets beyond what the issuer token already implies.

A replacement card in v1 is close, then issue. No separate replacement endpoint.

---

## Context

### Beginning context

**This homework** starts from `homework-3/TASKS.md` and `homework-3/specification-TEMPLATE-example.md`. No service code exists. The deliverable of the homework is the specification package, not the service.

**An implementation agent** starts from that package plus these hypothetical upstreams, which are not in the repo:

| Upstream | Contract the agent may assume |
|---|---|
| API gateway | Terminates cardholder/staff auth. Injects `X-Customer-Id`, `X-Actor-Role`, `X-Actor-Id`, `X-Sca-At`, `X-Request-Id`. Strips inbound copies of those headers |
| Accounts | `AccountsPort.owns(customerId, fundingAccountId): boolean`. EUR accounts only. No balance API |
| Identity | `IdentityPort.assertRecentSca(customerId, maxAgeSeconds): boolean` |
| Issuer processor | `createVirtualCard`, `revealSecret`, both idempotent on `card_id` |
| PostgreSQL 16 | Empty database `virtual_cards`, app role as in NFR-SEC |
| Redis | Used only for cardholder/staff rate limits. Authorization path must not read Redis |

No `services/virtual-cards/` tree exists at the start.

### Ending context

After the low-level tasks, the tree below exists, tests in [Verification](#verification) pass, and a local `docker compose` brings up PostgreSQL, Redis, and the service. This homework does **not** create that tree; the list is the implementation agent’s definition of done.

```
services/virtual-cards/
├── package.json
├── tsconfig.json
├── docker-compose.yml
├── docs/trust-boundary.md
├── db/migrations/001_init.sql
├── src/domain/money.ts
├── src/domain/ids.ts
├── src/domain/card.ts
├── src/domain/limit.ts
├── src/domain/decision.ts
├── src/domain/errors.ts
├── src/domain/audit.ts
├── src/ports/accounts.ts
├── src/ports/identity.ts
├── src/ports/issuer.ts
├── src/ports/cardRepository.ts
├── src/ports/auditLog.ts
├── src/application/issueCard.ts
├── src/application/freezeCard.ts
├── src/application/setLimit.ts
├── src/application/closeCard.ts
├── src/application/decideAuthorization.ts
├── src/application/applyReversal.ts
├── src/application/applyClearing.ts
├── src/application/listTransactions.ts
├── src/application/revealCard.ts
├── src/application/searchAudit.ts
├── src/application/reconcilePendingIssue.ts
├── src/http/app.ts
├── src/http/cardholderRoutes.ts
├── src/http/opsRoutes.ts
├── src/http/issuerRoutes.ts
├── src/http/rateLimit.ts
├── src/logging/redact.ts
├── src/persistence/postgres.ts
└── test/…
```

Runtime state at completion of a happy-path issue: one `active` row, one `card_issued` audit row, one idempotency row, meter at 0, no PAN/CVV column anywhere in `001_init.sql`.

---

## Edge Cases and Failure Modes

Expected behavior is the user-visible outcome plus the audit consequence. “No audit” means no **new** audit row.

| ID | Situation | Expected behavior | Audit |
|---|---|---|---|
| EC-01 | First issue, issuer approves | `201`, masked card, `active` | `card_issued` |
| EC-02 | Issue when an open card already exists | `422 card_already_open`, issuer not called | none |
| EC-03 | Replay of EC-01 with same key and body | Stored `201` replayed, still one card | none |
| EC-04 | Same key, different body | `409 idempotency_conflict` | none |
| EC-05 | Issuer timeout after pending row commits | `202`, status `pending_issuer`. Retry with same key calls issuer again with the same `card_id` | `card_issue_pending` once |
| EC-06 | Issuer business rejection | `422 issuer_rejected`, status `issue_failed`, account may issue again | `card_issue_failed` |
| EC-07 | Two concurrent issues, same account, different keys | One `201` or `202`; the other `422 card_already_open`. Unique index is the backstop | one issue event |
| EC-08 | Freeze an active card | `200`, `display_status=frozen`, `freeze.user=true` | `freeze_set` |
| EC-09 | Freeze when already user-frozen | `200` current resource | none |
| EC-10 | Unfreeze user flag while compliance hold remains | `200`, still `frozen`, `freeze.bank=true`, `freeze.user=false` | `freeze_cleared` for `user` only |
| EC-11 | Cardholder calls compliance-release | `403`. Flag unchanged | none |
| EC-12 | Support clears a compliance hold | `403` | none |
| EC-13 | Authorization arrives after freeze commits | `200 decision=declined reason=card_frozen`. Meter unchanged | `authorization_declined` |
| EC-14 | Cardholder unfreezes during a bank hold and immediately pays | Decline `card_frozen`. Cardholder still sees frozen-by-bank | decline event |
| EC-15 | Two auths race, each within limit, sum over limit | One approved, one `limit_exceeded`, under row lock | both decisions |
| EC-16 | Limit `"9.99"`, `"5000.01"`, `"10"`, `"10.0"`, `10.00` (number), `"010.00"` | `422 limit_out_of_range` or `400 amount_invalid`. No partial write. Strings must be canonical two-decimal | none |
| EC-17 | Set limit below current month spend | `200`, limit updated, `remaining_this_month` is `"0.00"` (clamp display at zero, do not show a negative) | `limit_changed` |
| EC-18 | Set limit on a frozen card | Allowed. Freeze and limit are independent | `limit_changed` |
| EC-19 | Stale `expected_version` | `409 version_conflict` plus current resource. No write | none |
| EC-20 | Cardholder GET/POST on another customer’s card | `404 card_not_found` | none |
| EC-21 | Unknown card id | `404 card_not_found` (same body shape as EC-20) | none |
| EC-22 | Transaction list on a new card | `200 { "data": [], "next_cursor": null }` | none |
| EC-23 | Tampered or truncated cursor | `400 invalid_cursor` | none |
| EC-24 | `limit=101` | `400 invalid_page_size` | none |
| EC-25 | Expired card, not frozen | Display `expired`. Auth decline `card_expired` | decline event |
| EC-26 | Frozen and expired | Display `frozen` (freeze wins the label). Auth decline `card_expired` (precedence) | decline event |
| EC-27 | Clearing for an unknown auth | `422 unknown_authorization`. No meter change | none |
| EC-28 | Duplicate clearing same `issuer_clearing_id` | Replay `200`, meter unchanged the second time | none |
| EC-29 | Reversal larger than remaining auth amount | `422 reversal_exceeds_authorization` | none |
| EC-30 | Reveal without SCA or SCA older than 300 s | `403 sca_required`. No issuer reveal call | none |
| EC-31 | Reveal of a closed card | `422 card_not_revealable` | none |
| EC-32 | Log line would have included a 16-digit PAN | The emitted log contains only `last4` or `[redacted]`. Test scans the log sink | `pan_revealed` if the reveal itself succeeded, still without PAN |
| EC-33 | `pending_issuer` older than 30 s, reconciler runs, issuer now knows the card | Row becomes `active` | `card_issued` |
| EC-34 | Reconciler runs, issuer has no card, create now returns rejection | `issue_failed` | `card_issue_failed` |
| EC-35 | Close, then issue again on the same account | Allowed. New `card_id`. Old transactions stay on the old id | `card_closed`, then `card_issued` |
| EC-36 | Authorization for `pending_issuer` | Decline `card_not_active` | decline event |
| EC-37 | Missing `Idempotency-Key` on a mutation | `400 idempotency_key_required` | none |
| EC-38 | Clock: auth at 23:59 Europe/Rome on the last day of the month, next auth at 00:01 | First counts in month N, second in month N+1. Meter resets because the window changed | each decision once |
| EC-39 | Replay of a successful reveal with the same idempotency key and body | `409 reveal_not_replayable`. Issuer reveal is not called again. The stored idempotency body is `{"redacted":true}` and contains no PAN or CVV | the original `pan_revealed` only |

---

## Verification

How an implementer knows each mid-level objective is met. Tests are part of the service tasks; this homework only specifies them.

| Objective | Proof |
|---|---|
| M1 | Integration: issue → masked `201`; duplicate account → `422` and issuer fake call count stays 1; idempotent replay; timeout → `202` then reconciler → `active`; unique index under parallel issues (EC-07) |
| M2 | Unit: flag matrix including EC-10 and EC-14. Integration: freeze then authorize → `card_frozen` and unchanged meter. Timing check is a single-process test that the decision reads the committed flag with no cache layer in between, not a production load test |
| M3 | Table tests for bounds and string canonicalization (EC-16, EC-17). Integration: approve, second auth over the remainder declines, reversal restores budget, clearing replaces amount, concurrent pair (EC-15) |
| M4 | Integration: empty list; page boundaries; cursor tamper; read-your-writes after approve and after clearing; declines absent from cardholder payload; `limit` above 100 rejected |
| M5 | Role matrix test for every route × role (expect 403 or 404 as specified). Migration test: app role `INSERT` into audit succeeds, `UPDATE` and `DELETE` fail. Search returns the issue and freeze events for a fixture customer and does not return another customer’s events |
| M6 | Log snapshot test with a PAN and a CVV planted in a child logger (EC-32). Schema test: no column name matches `pan`, `cvv`, `cvc`, `track`. Reveal without SCA does not increment the issuer fake’s reveal counter. Cross-customer access is 404 (EC-20) |

**Fixtures** (implementation): `test/fixtures/cardholder.json`, `other-customer.json`, `active-card.json`, `frozen-bank.json`, `month-boundary.json`. Issuer is an in-memory fake, never the network, in unit and integration tests. One contract test file asserts the fake and the HTTP client share request field names from `src/ports/issuer.ts`.

**Manual compliance checkpoint** (once, before calling the feature done): a reviewer reads `001_init.sql` and a sample of log output from the integration run and confirms there is no PAN column and no full PAN in logs. Record the result in the PR that implements the service, not in this homework.

**Not required for v1:** a multi-host load test. The p95 numbers are design targets for later. The in-process race in EC-15 is required now because correctness of the limit depends on it.

---

## Low-Level Tasks

Implement in this order. Each task’s acceptance criteria are the definition of done. Do not start a task by weakening an earlier one.

The prompt blocks are what an implementation agent should be given, together with this file.

### T01 — Money type

**Serves:** M3, implementation note “Money”

What prompt would you run to complete this task?
Create `src/domain/money.ts` exporting cents arithmetic and a JSON parser/formatter. No floats. Canonical strings only.

What file do you want to CREATE or UPDATE?
`services/virtual-cards/src/domain/money.ts`

What function do you want to CREATE or UPDATE?
`parseEurToCents`, `formatCents`, `addCents`, `subtractCents`

What are details you want to add to drive the code changes?
`parseEurToCents` accepts only `^-?\d+\.\d{2}$` and then rejects negatives for limits and authorizations via a `signed` flag the caller passes (default unsigned). `"10.00"` → `1000n`. `"10"`, `"10.0"`, `"010.00"`, `"10.000"`, `10` (if it ever arrives as a number, the HTTP layer must not coerce; the parser accepts strings only) → throw `AmountInvalid`. `formatCents(1000n)` → `"10.00"`. `subtractCents` that would go negative throws `InsufficientAmount` and lets the caller clamp display separately.

**Acceptance criteria:**
- [ ] `10.00`, `5000.00`, `0.01` round-trip through parse and format
- [ ] Rejected strings match EC-16’s non-canonical examples
- [ ] No `number` arithmetic in this module

### T02 — Identifiers

**Serves:** M1, M6

What prompt would you run to complete this task?
Add ULID-based id helpers for card, transaction, and audit ids, plus a predicate for upstream `cus_` and `acc_` ids and for idempotency keys.

What file do you want to CREATE or UPDATE?
`services/virtual-cards/src/domain/ids.ts`

What function do you want to CREATE or UPDATE?
`newCardId`, `newTxnId`, `newAuditId`, `isCustomerId`, `isAccountId`, `isIdempotencyKey`

What are details you want to add to drive the code changes?
Follow the identifier table in Implementation Notes. `isIdempotencyKey` is the 8–64 charset check. Do not log generated ids as a substitute for audit.

**Acceptance criteria:**
- [ ] New card ids match `^card_[0-9A-HJKMNP-TV-Z]{26}$`
- [ ] Idempotency key `short` is rejected; a 16-char key of the allowed alphabet is accepted
- [ ] Customer id without the `cus_` prefix is rejected

### T03 — Card display model and status

**Serves:** M1, M2, M6

What prompt would you run to complete this task?
Define the card aggregate and pure functions for display status and the public freeze object. No I/O.

What file do you want to CREATE or UPDATE?
`services/virtual-cards/src/domain/card.ts`

What function do you want to CREATE or UPDATE?
`deriveDisplayStatus`, `toCardholderView`, `toComplianceView`

What are details you want to add to drive the code changes?
Implement the display precedence in Implementation Notes. `toCardholderView` includes `remaining_this_month` clamped at `"0.00"` when spend exceeds the limit (EC-17). It omits `compliance` and `fraud` keys. `toComplianceView` includes them. Neither view includes `issuer_card_token`.

**Acceptance criteria:**
- [ ] EC-25 and EC-26 display statuses match the table
- [ ] Cardholder JSON from a compliance-held card has `bank: true` and no `fraud` key
- [ ] Snapshot of the view contains neither a 13–19 digit run nor a field named `pan` or `cvv`

### T04 — Limit policy and month window

**Serves:** M3

What prompt would you run to complete this task?
Implement inclusive EUR bounds, the default limit, and the Europe/Rome calendar-month window.

What file do you want to CREATE or UPDATE?
`services/virtual-cards/src/domain/limit.ts`

What function do you want to CREATE or UPDATE?
`DEFAULT_LIMIT_CENTS`, `assertLimitCents`, `monthWindow`, `remainingCents`

What are details you want to add to drive the code changes?
Bounds 1000 to 500000 cents. `monthWindow(instant)` returns UTC instants for the Rome month containing `instant`. Cover EC-38 with a fixed clock input, not the machine clock. `remainingCents` returns 0 when spend ≥ limit, never a negative.

**Acceptance criteria:**
- [ ] 999 and 500001 cents throw a typed limit error; 1000 and 500000 pass
- [ ] An instant at 22:30 UTC on a date that is already the next calendar day in Rome falls in the new month
- [ ] EC-38’s two instants fall in different windows

### T05 — Error catalog

**Serves:** all objectives, error semantics

What prompt would you run to complete this task?
Add a single problem+json factory. Every code used in this spec maps to one HTTP status and a stable `type` URL.

What file do you want to CREATE or UPDATE?
`services/virtual-cards/src/domain/errors.ts`

What function do you want to CREATE or UPDATE?
`problem`, `AmountInvalid`, `LimitOutOfRange`, `VersionConflict`, `CardNotFound`, `ScaRequired`

What are details you want to add to drive the code changes?
`detail` strings are the cardholder-safe sentences from this spec. `VersionConflict` can attach the current masked view as `resource` without removing the problem fields. Never interpolate a raw PAN into `detail`.

**Acceptance criteria:**
- [ ] Each `code` in the edge-case table that names a code has exactly one mapping
- [ ] Serialized problems validate as the example shape in Implementation Notes
- [ ] `card_not_found` is status 404 for both unknown and not-owned; the body does not say which

### T06 — Audit event model

**Serves:** M5, NFR-AUD

What prompt would you run to complete this task?
Define the audit event type and the allowed `action` union. Provide a constructor that fills `id` and `created_at` and refuses extra secret fields.

What file do you want to CREATE or UPDATE?
`services/virtual-cards/src/domain/audit.ts`

What function do you want to CREATE or UPDATE?
`AuditAction`, `createAuditEvent`

What are details you want to add to drive the code changes?
Fields are exactly the audit event list in Implementation Notes. `createAuditEvent` accepts an object and deletes unknown keys rather than persisting them. There is no `pan` or `cvv` field on the type.

**Acceptance criteria:**
- [ ] A unit test passes a surplus `pan` property and the returned event does not contain it
- [ ] Every action named in Implementation Notes is in the union
- [ ] Events have no update method

### T07 — Schema migration

**Serves:** M1–M6, NFR-SEC, NFR-PRIV

What prompt would you run to complete this task?
Write the initial PostgreSQL migration for cards, monthly meters, authorization decisions, transactions, idempotency, and append-only audit. Grant the app role as specified.

What file do you want to CREATE or UPDATE?
`services/virtual-cards/db/migrations/001_init.sql`

What function do you want to CREATE or UPDATE?
SQL only. No function that returns a PAN.

What are details you want to add to drive the code changes?
Tables match the card record, meter (card_id, window_start, spent_cents), decisions (unique `issuer_auth_id`), transactions, idempotency (unique actor+key), audit. Partial unique index for one open card per funding account. `card_audit_events` has no update trigger that mutates rows; add a privilege revoke for `UPDATE, DELETE` from the app role. Comments in the SQL state that PAN and CVV are intentionally absent. Amounts are `bigint` cents. Timestamps are `timestamptz`.

**Acceptance criteria:**
- [ ] Migration applies on empty PostgreSQL 16
- [ ] A second open card for the same account fails the unique index
- [ ] App role insert into audit works; update and delete do not
- [ ] `\d` output contains no `pan` or `cvv` column

### T08 — Card repository

**Serves:** M1, M2, M3, concurrency notes

What prompt would you run to complete this task?
Implement the repository port with optimistic version checks and a `lockCardByIssuerToken` used only by the authorization path.

What file do you want to CREATE or UPDATE?
`services/virtual-cards/src/ports/cardRepository.ts`, `services/virtual-cards/src/persistence/postgres.ts`

What function do you want to CREATE or UPDATE?
`insertPending`, `saveIssueResult`, `updateWithVersion`, `lockByIssuerToken`, `findById`

What are details you want to add to drive the code changes?
`updateWithVersion` updates only when `version` equals `expected_version`, then increments. Zero rows updated → `version_conflict`. `lockByIssuerToken` is `SELECT … FOR UPDATE`. Repository methods do not write audit events; use cases do, in the same transaction the repository exposes (`withTransaction`).

**Acceptance criteria:**
- [ ] Two updates with the same `expected_version` → one success, one conflict
- [ ] `findById` for a missing id returns null; it does not throw 403
- [ ] Locked authorization section can read the freeze flags written by a previously committed freeze

### T09 — Idempotency store

**Serves:** M1, NFR-REL, EC-03, EC-04, EC-37

What prompt would you run to complete this task?
Persist idempotency records in the same database transaction as the business write. Replay or conflict as specified.

What file do you want to CREATE or UPDATE?
`services/virtual-cards/src/persistence/postgres.ts`

What function do you want to CREATE or UPDATE?
`beginIdempotent`

What are details you want to add to drive the code changes?
Scope key by actor id. Hash the canonical JSON body. On replay, return the stored status and body without running the use case, unless the stored body is the reveal redaction marker: then throw `reveal_not_replayable` and do not call the issuer (EC-39). On hash mismatch, throw `idempotency_conflict`. Never persist a reveal response body that contains PAN or CVV. Missing header is the HTTP layer’s job (400) before this function. TTL cleanup may delete rows older than 24 hours and must not delete card or audit rows.

**Acceptance criteria:**
- [ ] EC-03 and EC-04 behavior
- [ ] A failed business rule (`card_already_open`) stores nothing that would block a later *different* key, and the same key replays the 422
- [ ] Replay does not call the issuer fake
- [ ] EC-39: the idempotency row for reveal has no PAN or CVV, and the second call does not increment the fake reveal counter

### T10 — Issuer port and fake

**Serves:** M1, M6

What prompt would you run to complete this task?
Define `IssuerPort` with `createVirtualCard` and `revealSecret`, plus an in-memory fake that tests can fail, time out, or approve.

What file do you want to CREATE or UPDATE?
`services/virtual-cards/src/ports/issuer.ts`, `services/virtual-cards/test/fakes/issuer.ts`

What function do you want to CREATE or UPDATE?
`IssuerPort.createVirtualCard`, `IssuerPort.revealSecret`, `FakeIssuer`

What are details you want to add to drive the code changes?
`createVirtualCard` input is `{ cardId, customerId, currency }`. Output is `{ issuerCardToken, last4, expiryMonth, expiryYear }` or a typed business rejection. The fake records call count keyed by `cardId`. `revealSecret` returns PAN and CVV only to the caller. The fake must not write them to the repository.

**Acceptance criteria:**
- [ ] Two `createVirtualCard` calls with the same `cardId` return the same token and `callCount` can be asserted
- [ ] Timeout mode throws a typed `IssuerUnavailable` distinct from business rejection
- [ ] Port TypeScript types have no method that persists a PAN

### T11 — Issue card use case

**Serves:** M1, NFR-REL, EC-01 through EC-07

What prompt would you run to complete this task?
Implement the issue saga in the order given in Implementation Notes, including the pending state on issuer timeout.

What file do you want to CREATE or UPDATE?
`services/virtual-cards/src/application/issueCard.ts`

What function do you want to CREATE or UPDATE?
`issueCard`

What are details you want to add to drive the code changes?
Depend on `AccountsPort`, `IssuerPort`, repository, idempotency, and audit. Default limit 500.00 EUR when omitted. Do not return PAN. On `IssuerUnavailable`, commit `pending_issuer` and return a result the HTTP layer maps to 202. On unique-index violation, map to `card_already_open` even if the pre-check raced (EC-07).

**Acceptance criteria:**
- [ ] EC-01, EC-02, EC-05, EC-06 covered by tests using `FakeIssuer`
- [ ] EC-07 holds under two concurrent `issueCard` calls
- [ ] Response DTO is `toCardholderView`

### T12 — Freeze, unfreeze, compliance, fraud flags

**Serves:** M2, M5, EC-08 through EC-14

What prompt would you run to complete this task?
Implement flag set and clear with the actor matrix. Cardholder, support, compliance, and fraud service each have an entry function. No actor clears another actor’s flag.

What file do you want to CREATE or UPDATE?
`services/virtual-cards/src/application/freezeCard.ts`

What function do you want to CREATE or UPDATE?
`setFreezeFlag`, `clearFreezeFlag`

What are details you want to add to drive the code changes?
Enforce `expected_version`. No-op if the flag is already in the desired state (EC-09) without a new audit row. Cardholder clearing `user` while `bank` remains returns the frozen view (EC-10). Reject operations when `status !== 'active'` with `422 illegal_transition`. Map roles to flags exactly as the freeze table. Fraud service is not a superset of compliance.

**Acceptance criteria:**
- [ ] Matrix test: each role × each flag × set/clear, including 403 cases EC-11 and EC-12
- [ ] EC-10 changes only `freeze_user` and writes `freeze_cleared`
- [ ] EC-14 is expressed as a test that still declines after a user unfreeze when `freeze_compliance` is set (decision task can share the fixture)

### T13 — Set monthly limit

**Serves:** M3, EC-16, EC-17, EC-18

What prompt would you run to complete this task?
Implement `setLimit` for the cardholder on their own active card, including when the card is frozen and when the new limit is below month-to-date spend.

What file do you want to CREATE or UPDATE?
`services/virtual-cards/src/application/setLimit.ts`

What function do you want to CREATE or UPDATE?
`setLimit`

What are details you want to add to drive the code changes?
Parse money via T01. Enforce bounds via T04. Require version. Write `limit_changed` with from/to cents in `reason_code` encoded as `from:<cents>:to:<cents>` if no better structured field exists; do not add a PAN-bearing metadata blob. Frozen card is allowed (EC-18).

**Acceptance criteria:**
- [ ] EC-16 rejected before any update
- [ ] EC-17 persists the lower limit and the view’s remaining is `0.00`
- [ ] Another customer’s card is not found (EC-20), version not checked until ownership is established

### T14 — Close card

**Serves:** M1 (reissue), EC-35

What prompt would you run to complete this task?
Allow the cardholder to close an active card. Closed cards reject freeze, limit changes, reveal, and authorizations. A later issue on the same account is a new card id.

What file do you want to CREATE or UPDATE?
`services/virtual-cards/src/application/closeCard.ts`

What function do you want to CREATE or UPDATE?
`closeCard`

What are details you want to add to drive the code changes?
Idempotent if already closed (replay via idempotency key; a new key on an already-closed card returns `200` current view and no second audit event). Does not delete transactions.

**Acceptance criteria:**
- [ ] After close, the partial unique index allows a new open card (EC-35)
- [ ] Authorization on the closed token declines `card_closed`
- [ ] History list for the closed id still returns old transactions

### T15 — Authorization decision

**Serves:** M2, M3, EC-13, EC-15, EC-26, EC-36

What prompt would you run to complete this task?
Implement `decideAuthorization` with the decline precedence, row lock, and idempotent `issuer_auth_id`.

What file do you want to CREATE or UPDATE?
`services/virtual-cards/src/domain/decision.ts`, `services/virtual-cards/src/application/decideAuthorization.ts`

What function do you want to CREATE or UPDATE?
`decideAuthorization`

What are details you want to add to drive the code changes?
Business declines are normal results, not exceptions, so the HTTP layer returns 200. Meter changes only on a new approval. Duplicate id with the same body returns the stored decision and does not double-count. Duplicate id with a different amount is `idempotency_conflict`. Emit `spend_after_limit_increase` when the heuristic in Implementation Notes matches, and still approve if the limit allows. Precedence must match the numbered list, including expired-over-frozen (EC-26).

**Acceptance criteria:**
- [ ] Each decline reason has one test where a *higher* precedence condition is also true and the higher reason wins
- [ ] EC-15: two parallel approvals that together exceed the limit → exactly one approval and a meter ≤ limit
- [ ] Replay does not increase `spent_cents`

### T16 — Reversal and clearing

**Serves:** M3, M4, EC-27, EC-28, EC-29

What prompt would you run to complete this task?
Apply reversals and clearings idempotently and adjust the meter as specified: reversal subtracts, clearing replaces the auth amount.

What file do you want to CREATE or UPDATE?
`services/virtual-cards/src/application/applyReversal.ts`, `services/virtual-cards/src/application/applyClearing.ts`

What function do you want to CREATE or UPDATE?
`applyReversal`, `applyClearing`

What are details you want to add to drive the code changes?
Both lock the card row. Unknown auth → `unknown_authorization`. Reversal above remaining unreversed amount → `reversal_exceeds_authorization`. Duplicate clearing id replays. A clearing creates or updates the cardholder-visible transaction to `posted`. A still-uncleared approval is a `pending` transaction. Declines create no transaction row.

**Acceptance criteria:**
- [ ] Approve 20.00, clear 18.50 → meter drops by 1.50 and the list shows one `posted` line of 18.50
- [ ] EC-28 and EC-29
- [ ] Reversal of the full amount removes the pending line from the cardholder list (reversals are omitted)

### T17 — Transaction list

**Serves:** M4, EC-22, EC-23, EC-24

What prompt would you run to complete this task?
Return newest-first pending and posted transactions for one card, with an opaque cursor. Cardholder and staff use the same query after the route has authorized the actor.

What file do you want to CREATE or UPDATE?
`services/virtual-cards/src/application/listTransactions.ts`

What function do you want to CREATE or UPDATE?
`listTransactions`

What are details you want to add to drive the code changes?
Default page 20, max 100. Cursor is an HMAC-signed encoding of `{occurred_at, id, card_id}`. On read, `card_id` inside the cursor must equal the path card id or the cursor is `invalid_cursor`. Query the primary. Empty page is a 200-shaped result, not 404.

**Acceptance criteria:**
- [ ] EC-22, EC-23, EC-24
- [ ] A cursor minted for card A is invalid on card B
- [ ] After T15 approval commits, a list in a new transaction sees the pending row

### T18 — Reveal

**Serves:** M6, EC-30, EC-31, EC-32

What prompt would you run to complete this task?
Reveal PAN and CVV via the issuer only after SCA, only for an active card, and audit the fact without the secret.

What file do you want to CREATE or UPDATE?
`services/virtual-cards/src/application/revealCard.ts`

What function do you want to CREATE or UPDATE?
`revealCard`

What are details you want to add to drive the code changes?
Call `IdentityPort.assertRecentSca(customerId, 300)` first. On failure, do not call the issuer. Closed, pending, and issue_failed cards are `card_not_revealable`. Frozen cards may be revealed (the customer is copying the number while the card is locked). Response is `{ pan, cvv, expires_in_seconds: 60 }` and is not passed to the logger or the idempotency store. Audit `pan_revealed`. Rate limit is enforced in the HTTP layer; when it trips, the route writes `reveal_velocity` and does not call this use case. Replay behavior is EC-39, implemented in T09.

**Acceptance criteria:**
- [ ] EC-30 does not increment the fake reveal counter
- [ ] Successful reveal audit row has no PAN or CVV field
- [ ] EC-31
- [ ] EC-39

### T19 — Pending-issue reconciler

**Serves:** M1, NFR-REL, EC-33, EC-34

What prompt would you run to complete this task?
Add a function a scheduler can call every 10 seconds to finish `pending_issuer` rows older than 30 seconds.

What file do you want to CREATE or UPDATE?
`services/virtual-cards/src/application/reconcilePendingIssue.ts`

What function do you want to CREATE or UPDATE?
`reconcilePendingIssue`

What are details you want to add to drive the code changes?
For each candidate, call `createVirtualCard` with the existing `card_id`. Interpret outcomes as in the issue saga (EC-33, EC-34). Cap a run at 50 rows. Do not touch `active` cards. Two overlapping runs must not double-issue: lock the row `FOR UPDATE SKIP LOCKED`.

**Acceptance criteria:**
- [ ] A row 10 seconds old is left pending
- [ ] EC-33 and EC-34
- [ ] A second concurrent run does not call the issuer for a row the first run locked

### T20 — Cardholder and staff HTTP routes

**Serves:** M1–M5

What prompt would you run to complete this task?
Expose the cardholder and ops routes, map use-case results to the status codes in this spec, and require `Idempotency-Key` and `expected_version` where specified.

What file do you want to CREATE or UPDATE?
`services/virtual-cards/src/http/cardholderRoutes.ts`, `services/virtual-cards/src/http/opsRoutes.ts`, `services/virtual-cards/src/http/app.ts`

What function do you want to CREATE or UPDATE?
Cardholder handlers `postCard`, `getCard`, `postFreeze`, `postUnfreeze`, `putLimit`, `postClose`, `getTransactions`, `postReveal`. Ops handlers `getOpsCard`, `postSupportFreeze`, `postSupportUnfreeze`, `postComplianceHold`, `postComplianceRelease`, `postFraudHold`, `postFraudRelease`, `getAudit`.

What are details you want to add to drive the code changes?
Cardholder paths under `/v1/cards`. Ops under `/v1/ops`. `getOpsCard` returns `toComplianceView` for `compliance` and the cardholder-shaped view (with `bank`, without the fraud breakdown) for `support`. Fraud hold and release are ops routes callable only by `fraud_service`; compliance hold and release only by `compliance`; support freeze only by `support`. Search audit: compliance may query 7 years; support may query 90 days and receives 403 for a wider window; `fraud_service` receives 403 on search. Validate query bounds before hitting the database. Problem responses use `application/problem+json`.

**Acceptance criteria:**
- [ ] Route table in a test matches the method, path, and success status for every cardholder and ops operation in this spec
- [ ] EC-37
- [ ] Support calling compliance-release is 403
- [ ] `fraud_service` calling fraud-hold on an active card sets only `freeze_fraud`

### T21 — Issuer HTTP routes

**Serves:** M2, M3, M4

What prompt would you run to complete this task?
Expose processor routes that return 200 for business declines and problem responses only for malformed calls and infrastructure failures.

What file do you want to CREATE or UPDATE?
`services/virtual-cards/src/http/issuerRoutes.ts`

What function do you want to CREATE or UPDATE?
`postAuthorization`, `postReversal`, `postClearing`

What are details you want to add to drive the code changes?
Paths: `POST /v1/issuer/authorizations`, `POST /v1/issuer/authorizations/:issuerAuthId/reversals`, `POST /v1/issuer/transactions`. These handlers do not read `X-Actor-Role`. They assume the server is configured for mTLS in `docs/trust-boundary.md`. A declined purchase is HTTP 200 with `decision` and `reason`.

**Acceptance criteria:**
- [ ] Freeze then authorize through HTTP → 200 and `card_frozen`
- [ ] Malformed amount → 400, not a decline body
- [ ] Duplicate auth id replay → 200 and one meter update (assert via repository)

### T22 — Actor context and rate limit

**Serves:** NFR-SEC, NFR-PERF

What prompt would you run to complete this task?
Build the actor from gateway headers and apply the rate limits. Do not rate-limit the authorization path through Redis.

What file do you want to CREATE or UPDATE?
`services/virtual-cards/src/http/app.ts`, `services/virtual-cards/src/http/rateLimit.ts`

What function do you want to CREATE or UPDATE?
`readActor`, `consumeCardholderLimit`

What are details you want to add to drive the code changes?
If `X-Actor-Role` is missing on `/v1/cards` or `/v1/ops`, return 401. Ignore any body field named `role` or `customer_id` for authorization. Limits: 10 mutations/min, 120 reads/min, 3 reveals/hour/card. `429` includes `Retry-After`. Document in `docs/trust-boundary.md` that Redis holds counters only.

**Acceptance criteria:**
- [ ] The 11th mutation in a minute is 429 and the 10th succeeded
- [ ] Fourth reveal in an hour is 429 and writes `reveal_velocity` once
- [ ] Issuer authorization does not open a Redis connection (assert with a fake Redis that throws if called)

### T23 — Log redaction

**Serves:** M6, EC-32

What prompt would you run to complete this task?
Configure the logger so PAN-shaped numbers, CVV fields, and authorization headers never reach the sink.

What file do you want to CREATE or UPDATE?
`services/virtual-cards/src/logging/redact.ts`

What function do you want to CREATE or UPDATE?
`redact`

What are details you want to add to drive the code changes?
Redact keys `pan`, `cvv`, `cvc`, `authorization`, `cookie` case-insensitively. Replace digit runs of 13–19 digits in string values with `[redacted]`, including inside `detail` and merchant name. Do not redact 4-digit `last4` fields when the key is `last4`. Apply this inside the process before write, not as a log-platform filter.

**Acceptance criteria:**
- [ ] EC-32: a message containing `4111111111111111` and `cvv: 123` is stored without those values
- [ ] `last4: "4242"` survives
- [ ] Reveal route test’s log buffer does not contain the fake PAN returned to the client

### T24 — Automated proof of the objectives

**Serves:** Verification section for M1–M6

What prompt would you run to complete this task?
Add the unit, integration, and role-matrix tests listed in Verification. Use the fakes. Do not call a real issuer or a real bank.

What file do you want to CREATE or UPDATE?
`services/virtual-cards/test/money.test.ts`, `services/virtual-cards/test/card-status.test.ts`, `services/virtual-cards/test/limit-window.test.ts`, `services/virtual-cards/test/issue.integration.test.ts`, `services/virtual-cards/test/decision.integration.test.ts`, `services/virtual-cards/test/authz.integration.test.ts`, `services/virtual-cards/test/redact.test.ts`

What function do you want to CREATE or UPDATE?
Test cases named after edge-case ids (`EC-07`, `EC-15`, `EC-20`, `EC-32`, and the rest of the table).

What are details you want to add to drive the code changes?
Each mid-level objective’s “Proof” cell must be executable. Name tests so a failure points at an EC id or an M id. Integration tests use PostgreSQL (testcontainers or the compose database), not a mocked SQL string. The manual compliance checkpoint stays manual and is not faked as a passing test.

**Acceptance criteria:**
- [ ] `npm test` covers every row of the edge-case table with an assertion on status code or decision reason and, where the table requires it, on the audit action
- [ ] M5 privilege test fails if the migration grants audit `UPDATE`
- [ ] No test logs a full PAN on failure output; assertion failures print last4 and ids only

---

## Traceability

| Objective | Tasks | Edge cases used as proof | Performance constraint |
|---|---|---|---|
| M1 Issue | T01, T02, T07, T09, T10, T11, T14, T19, T20 | EC-01–EC-07, EC-33–EC-35 | Issue p95 ≤ 800 ms assumed; reconciler batches 50 |
| M2 Freeze | T03, T08, T12, T15, T21 | EC-08–EC-14, EC-26 | Freeze p95 ≤ 150 ms; visible to decision ≤ 1 s |
| M3 Limit | T01, T04, T13, T15, T16 | EC-15–EC-18, EC-38 | Decision p95 ≤ 100 ms; row lock is the consistency mechanism |
| M4 Transactions | T16, T17, T20, T21 | EC-22–EC-24, EC-27–EC-29 | List p95 ≤ 200 ms; page max 100; primary reads |
| M5 Compliance | T06, T07, T12, T20, T24 | EC-11, EC-12, EC-14 | Audit search p95 ≤ 500 ms on a 31-day window |
| M6 Secrets | T03, T09, T10, T18, T22, T23, T24 | EC-20, EC-21, EC-30–EC-32, EC-39 | Reveal capped at 3/hour; not on the purchase path |
