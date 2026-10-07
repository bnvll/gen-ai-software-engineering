# Agent guidelines — Harbor virtual cards

You implement `homework-3/specification.md`. You do not redesign the product in code. If the spec is silent, stop and ask. If the spec is explicit, follow it even when a more general pattern is familiar.

## Read first

1. `specification.md` — objective you are serving (M1–M6), the implementation notes, and the edge-case row for the behavior you are about to write.
2. This file — how to work.
3. `.cursor/rules/` — constraints that stay on while you edit.

Work one low-level task (T01–T24) at a time. Do not skip to HTTP routes before the domain types and migration exist.

## Tech stack assumptions

| Choice | Assumption |
|---|---|
| Language | TypeScript, strict mode. No `any` on money, ids, or authorization results |
| Runtime | Node.js 22 |
| HTTP | Fastify. Problem responses are `application/problem+json` |
| Database | PostgreSQL 16. SQL in the repository, no ORM |
| Rate limits | Redis only for cardholder and staff counters |
| Tests | Vitest. Integration tests against real PostgreSQL |
| Money | `bigint` cents internally. Decimal strings at the JSON boundary |
| Ids | ULID with the prefixes in the spec |

These are assumptions for a service that does not exist yet. Do not add Java, Python, or a second HTTP framework beside them.

Out of scope stays out of scope: KYC, ledger balances, ISO 8583, 3-D Secure, physical cards, disputes, notifications.

## Domain rules

- One open card (`pending_issuer` or `active`) per funding account. The partial unique index is the backstop, not a comment.
- Freeze flags are independent. An actor clears only the flag they own. Cardholder JSON says `bank: true` and never `fraud` or `compliance`.
- Business declines on the issuer authorization route are HTTP 200 with `decision: "declined"`. Do not “fix” that into a 422.
- Issue is a saga: persist `pending_issuer`, then call the issuer, then mark `active` or `issue_failed`. A timeout does not create a second `card_id`.
- The month boundary is `Europe/Rome`, stored as `timestamptz` UTC.
- Authorization metering and the decision row commit in one transaction under `SELECT … FOR UPDATE` on the card.
- Audit is append-only. A mistake is a new event.

## Code style

- Files and functions match the names in the low-level tasks. Do not rename `decideAuthorization` to `handleAuth` for taste.
- Use cases take ports as arguments. They do not import Fastify or `pg` directly.
- HTTP handlers parse input, call one use case, and map the result. They do not contain limit arithmetic.
- Errors cross the HTTP boundary only as the catalog in `src/domain/errors.ts`.
- Comments explain a spec rule (why a decline returns 200, why remaining spend clamps at zero). They do not restate the code.
- SQL uses bind parameters. No string-concatenated ids.

## Testing and verification

- Every new behavior names the edge-case id (`EC-15`) or the objective (`M3`) in the test name.
- Required proofs are the Verification table in the spec. A task is not done when the happy path passes and the table row is untested.
- Issuer and identity are fakes in tests. Do not skip tests because a sandbox cannot reach a processor.
- Race tests (one open card, two authorizations over the limit) are required. They are how M1 and M3 are shown to be true.
- Failure output may print card id, last4, status, and `correlation_id`. It must not print PAN or CVV.
- Do not lower an assertion to match a wrong implementation. Change the implementation or stop and quote the spec conflict.

## Security and compliance constraints

- Do not add columns or log fields for PAN, CVV, track, or PIN. The service stores `issuer_card_token` and `last4`.
- Reveal goes through `IssuerPort.revealSecret` only after SCA inside 300 seconds. The response body is not logged.
- Cardholder access to someone else’s card is `404 card_not_found`, same body as an unknown id.
- Trust `X-Customer-Id`, `X-Actor-Role`, `X-Actor-Id`, and `X-Sca-At` as gateway-injected. A `role` field in JSON is not a role.
- The application database role does not receive `UPDATE` or `DELETE` on `card_audit_events`.
- Do not put card secrets, idempotency response bodies that contain a reveal payload, or full problem details with upstream error text into logs. Run values through `redact`.
- Do not invent a second store “just for debug” that keeps the PAN.

## How to treat edge cases

- Look up the situation in the edge-case table before writing the branch.
- If the table says “no audit”, do not write an event because it feels safer.
- If the table says the operation succeeds but the card stays frozen (cardholder unfreeze during a bank hold), return 200 and the frozen view. Do not return 409.
- Idempotent no-ops (freeze when already frozen, duplicate clearing) return success and do not append a second business event.
- On issuer timeout after the pending row commits, return 202. Do not roll back a row the client may already have seen on retry.
- Prefer the spec’s decline precedence over a “more helpful” reason. Expired and frozen together decline as `card_expired`.
- Fraud heuristics in the spec (`reveal_velocity`, `spend_after_limit_increase`, `freeze_churn`) alert. They do not silently block, except where a hard rule already declines (limit, freeze, expiry).

## When to stop

Stop and report the conflict when:

- A task prompt and an edge-case row disagree (the edge-case row wins until a human edits the spec).
- A change would store a PAN or weaken the audit grants to make a test pass.
- You need a product decision the spec marks out of scope (disputes, physical cards, a new currency).
- An assumed performance target cannot be met without a cache of the freeze flag. Do not add that cache; the target exists so the flag is read from the primary row.

## Definition of done for a task

- Acceptance criteria in the task are checked.
- New tests fail if the behavior is reverted.
- No PAN/CVV in the diff of schema, logs, or fixtures.
- The PR description names the task ids and the objectives they serve.
