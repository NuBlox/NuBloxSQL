# Tier-1 Stable Evidence Register

## Purpose

This register is the release-facing evidence map for NuBloxSQL Tier-1 dialects: PostgreSQL, MySQL and SQLite. It links each stability claim to concrete repository evidence and distinguishes implemented capability from qualified capability.

A claim is considered **qualified** only when its implementation, automated tests, supported-version matrix and failure-path evidence are all present. Documentation alone does not qualify a claim.

## Evidence status

- **qualified** — implementation and automated evidence exist for the supported matrix.
- **qualified baseline** — stable baseline evidence exists; deeper engine-specific expansion may continue.
- **not applicable** — the runtime model does not use this capability.

## PostgreSQL

| Stability area | Status | Primary evidence |
| --- | --- | --- |
| Native protocol and lifecycle | qualified | `lib/dialects/postgresql/test/protocol.js`, `runtime.js`, `lifecycle.js` |
| Authentication and TLS | qualified | protocol/runtime qualification and live PostgreSQL workflows |
| Prepared execution and typed values | qualified | contract/runtime/type qualification |
| Transactions and pooled transaction safety | qualified | `pool-transaction.js` and shared transaction contracts |
| Cancellation and deadlines | qualified | `cancel.js`, shared operation-control contracts |
| Streaming/backpressure | qualified | portal and COPY qualification |
| Result/resource limits | qualified | `result-limits.js` |
| Native type fidelity | qualified baseline | `type-decoding.js` |
| COPY FROM/TO | qualified | `copy-protocol.js` plus live PostgreSQL 15–18 qualification |
| LISTEN/NOTIFY | qualified | `notifications.js` plus live qualification |
| Structured EXPLAIN | qualified | `diagnostics.js` plus PostgreSQL 15–18 qualification |
| Deep catalog metadata | qualified | `deep-metadata.js` plus PostgreSQL 15–18 qualification |
| Observability/error contracts | qualified baseline | shared client observability/error contracts plus dialect runtime tests |
| Performance/memory evidence | qualified baseline | existing production/release evidence |
| Multi-version live matrix | qualified | PostgreSQL 15, 16, 17 and 18 workflows |

## MySQL

| Stability area | Status | Primary evidence |
| --- | --- | --- |
| Native protocol and lifecycle | qualified | `lib/dialects/mysql/test/protocol.js`, `api.js` |
| Authentication plugins and transport | qualified | `auth.js`, `auth-plugins.js`, MySQL 8.4/9.7 live qualification |
| Prepared execution and typed binds | qualified | `prepared.js`, `typed-bind.js` |
| Session reset/pooling correctness | qualified | `session-reset.js` and client pool contracts |
| Streaming/backpressure | qualified | `streaming.js` |
| Deadlines/cancellation | qualified | `operation-control.js` |
| Secure LOCAL INFILE | qualified | `local-infile.js` plus live MySQL qualification |
| Structured EXPLAIN | qualified | `diagnostics.js` plus MySQL 8.4/9.7 qualification |
| Deep INFORMATION_SCHEMA/security metadata | qualified | `deep-metadata.js` plus live qualification |
| Observability/error contracts | qualified baseline | shared client observability/error contracts plus dialect tests |
| Performance/memory evidence | qualified baseline | existing production/release evidence |
| Multi-version live matrix | qualified | MySQL 8.4 and 9.7 workflows |

## SQLite

| Stability area | Status | Primary evidence |
| --- | --- | --- |
| Embedded lifecycle and prepared execution | qualified | `lib/dialects/sqlite/test/runtime.js`, `lifecycle.js` |
| Transactions/savepoints | qualified | runtime/lifecycle qualification |
| Storage policy and WAL management | qualified | `storage.js` |
| Integrity and maintenance APIs | qualified | `maintenance.js` |
| Extension/security policy | qualified | `extensibility-security.js` |
| Native feature fidelity | qualified | `feature-fidelity.js` |
| Structured diagnostics | qualified | `query-diagnostics.js` |
| Changesets | qualified baseline | `changesets.js` |
| Resource governance | qualified | `resource-governance.js` |
| Deterministic error contracts | qualified | `errors.js`, `corruption-error-classification.js` |
| Production performance evidence | qualified | `production-performance.js`, Node 22/24/26 SQLite workflow |
| Production memory evidence | qualified | `production-memory.js`, Node 22/24/26 SQLite workflow |
| WAL/rollback contention | qualified | `production-concurrency.js`, PR #205 |
| Corrupt/malformed storage and hostile metadata | qualified | `production-corruption.js`, PR #206 |

SQLite's current P0 production-hardening evidence set is complete in the repository.

## Shared Tier-1 release invariants

The following requirements apply to every Tier-1 dialect where relevant:

| Invariant | Required evidence |
| --- | --- |
| Public single-entry API | root `nubloxsql` package routing and public API release contract |
| Typed dialect discrimination | public TypeScript contracts and dialect-surface qualification |
| Capability honesty | static/runtime capability tests must not claim unimplemented runtime helpers |
| Lifecycle determinism | open/close/reuse behaviour covered by dialect and shared lifecycle tests |
| Bind semantics | prepared and typed bind qualification where the engine exposes bind APIs |
| Transaction correctness | commit/rollback/savepoint and pooled/session boundaries where applicable |
| Failure classification | native failures normalized without erasing native diagnostic detail |
| Resource cleanup | deterministic close/failure cleanup and bounded operations |
| Security boundaries | authentication/transport/input/extension policies appropriate to the engine |
| Version matrix | explicit supported engine versions and Node.js 22/24/26 qualification |
| Native detail retention | portable contracts may normalize facts but must retain native payloads where available |
| Release boundary | proprietary-source and packed-consumer audits must pass |

## Release decision rule

A Tier-1 stable claim must be traceable from:

1. public capability or API claim;
2. implementation;
3. deterministic automated test;
4. supported Node.js matrix;
5. engine-version matrix where applicable;
6. failure/adversarial evidence appropriate to the feature;
7. release/package qualification.

If any link is missing, the claim remains partial rather than qualified.

## Next Wave-4 work

With the current Tier-1 P0 runtime gates closed, the next shared deliverables are:

1. richer portable metadata vocabulary proven across all Tier-1 engines;
2. cross-dialect diagnostics/EXPLAIN entry point retaining native payloads;
3. unified failure/adversarial matrix;
4. final roadmap and release-contract reconciliation before SQL compiler expansion resumes.
