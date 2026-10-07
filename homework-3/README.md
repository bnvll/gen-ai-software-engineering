# Homework 3: Specification-Driven Design

**Student:** Simone Benevelli
**Date:** 7 October 2026
**Feature:** Harbor virtual-card lifecycle (issue, freeze, monthly limit, transactions, compliance hold)

## Student & task summary

This homework is a specification package for one retail-banking feature: a cardholder who already passed KYC can hold a single open EUR virtual debit card, freeze it, set a monthly spend limit, and read transactions. Compliance can place a hold the cardholder cannot lift, and every state change is reconstructable from an append-only audit log.

No service code is included. The graded artifact is the spec: layered objectives, guardrails, edge cases, verification, and performance targets an implementer could execute without guessing.

| File | Role |
|---|---|
| [`specification.md`](specification.md) | Product contract: objectives M1–M6, policy, implementation notes, context, 39 edge cases, verification, tasks T01–T24 |
| [`agents.md`](agents.md) | How an implementation agent behaves: stack, domain rules, tests, secrets, when to stop |
| [`.cursor/rules/fintech-safety.mdc`](.cursor/rules/fintech-safety.mdc) | Always-on constraints (money, PAN, audit, tenancy, scope) |
| [`.cursor/rules/virtual-cards-implementation.mdc`](.cursor/rules/virtual-cards-implementation.mdc) | File-scoped shape rules for `services/virtual-cards/**/*.ts` |
| [`specification-TEMPLATE-example.md`](specification-TEMPLATE-example.md) | Course template this spec was built from |
| [`TASKS.md`](TASKS.md) | Assignment brief |

The template’s prompt / file / function / details blocks are kept on every low-level task, and each task adds the objective it serves plus acceptance criteria.

## Rationale

**Why a virtual card, and why this slice.** The brief’s example (create, freeze, limits, transactions, plus an internal compliance view) is already a full control loop: a write means nothing unless the authorization path observes it. The spec therefore includes the processor-facing decision, reversal, and clearing endpoints. Without them, “freeze” and “limit” are fields on a row. Ledger balances, KYC, 3-D Secure, physical cards, and disputes are named as out of scope so an agent does not invent them.

**Why the layers are split the way they are.** Mid-level objectives are observable outcomes (what a caller sees). Security, retention, and latency sit in Non-Functional & Policy so they are not buried inside one task. Implementation notes are the rules that are easy to “improve” incorrectly: integer cents, HTTP 200 for business declines, 404 for cross-customer access, saga on issuer timeout. Edge cases are a table with an id so tasks and tests can point at `EC-15` instead of restating the story. The traceability table at the end ties each objective to tasks, edge cases, and the performance constraint that matters for it.

**Why these performance targets.** They are labeled assumed targets in `specification.md` under NFR-PERF. Freeze and authorization are on the lost-card and purchase paths, so their budgets are tight (p95 150 ms and 100 ms) and the freeze flag is specified as a primary-row read with no cache, visible within 1 second. Issue is allowed p95 800 ms because it waits on an issuer. List and audit-search budgets match interactive screens, not batch jobs. Rate limits distinguish reveal (3/hour, secret-bearing) from ordinary reads. A multi-host load test is explicitly not required for v1; the race tests are required, because the limit is wrong if two authorizations can both pass it.

**Why verification is specified this deeply.** Each objective has a proof cell: integration behavior, a role matrix, a privilege check on the audit table, and a log redaction test. Several tasks end in checklists an implementer can tick, and T24 exists only to turn the edge-case table into named tests. The one manual step (a human reads the migration and a log sample for PAN leakage) is called out as manual so it is not replaced by a test that asserts nothing.

**Why Cursor rules are short and `agents.md` is longer.** Rules stay in context on every edit, so they only carry the constraints that are expensive to get wrong. `agents.md` carries stack, style, the edge-case protocol, and the instruction to stop rather than reinterpret the spec. Rules live under `homework-3/.cursor/rules/` so the submission is self-contained. In a repo whose root is this service, the same files belong at the repository root `.cursor/rules/`.

## Industry best practices

| Practice | Where it appears |
|---|---|
| PCI scope reduction: no PAN or CVV at rest; reveal is a separate SCA step; audit records the fact, not the secret | `specification.md` M6, NFR-PRIV, T10, T18, T23; `agents.md` “Security and compliance constraints”; `fintech-safety.mdc` |
| Strong customer authentication before revealing card secrets (300-second freshness) | `specification.md` M6, NFR-SEC, EC-30, T18 |
| Object-level authorization and indistinguishable 404 for unknown vs. not owned | `specification.md` NFR-SEC, EC-20, EC-21, T05; `agents.md`; `fintech-safety.mdc` |
| Least privilege on the audit table (`INSERT`/`SELECT` only) and append-only corrections | `specification.md` NFR-SEC, NFR-AUD, M5 proof, T07; `agents.md` |
| Idempotency keys on mutations, including conflict on a reused key with a different body | `specification.md` Implementation Notes, EC-03, EC-04, EC-37, T09; `agents.md` |
| Optimistic concurrency for user actions, row locks for the payment decision | `specification.md` Implementation Notes, EC-15, EC-19, T08, T15 |
| Saga with an explicit pending state when the issuer times out, reconciler bounded by `SKIP LOCKED` | `specification.md` NFR-REL, EC-05, EC-33, EC-34, T11, T19 |
| Integer minor units and canonical decimal strings; no binary floats | `specification.md` Implementation Notes “Money”, T01; `fintech-safety.mdc` |
| Stable problem codes (RFC 9457) safe to show the cardholder | `specification.md` Errors, T05 |
| Role separation: cardholder, support, compliance, fraud service, processor | `specification.md` Stakeholders, freeze table, T12, T20 |
| Processor contract: business decline is not an HTTP failure, so the scheme can complete | `specification.md` Authorization decision, T21; `agents.md` |
| Read-your-writes on the cardholder’s own card and on the decision path | `specification.md` NFR-PERF, M2, M4 |
| Alerting heuristics that do not auto-block where v1 cannot unblock quickly | `specification.md` “Fraud-ish signals”, EC-14 related behavior, `agents.md` “How to treat edge cases” |
| Retention called out as an assumed EU retail policy, not as legal advice | `specification.md` NFR-PRIV |
| Trust boundary documented: gateway-injected identity headers, mTLS for the issuer | `specification.md` NFR-SEC, Beginning context, T22 |
