# Gate 1 Evidence — Clean-room MySQL feature parity

Gate 1 is complete on the v1 critical path. The replacement MySQL runtime in `packages/mysql-cleanroom` now satisfies the production surface required by `docs/v1/V1-RELEASE-PLAN.md` and remains a zero-package-dependency implementation.

This evidence record is intentionally scoped to Gate 1. It does not declare NuBloxSQL v1.0.0 ready: Gate 2 through Gate 5 remain mandatory.

## Gate decision

**Status: COMPLETE**

Gate 1 was closed after PR #104 merged to `main` as `cbc6b66ceb2e5e220d624e34cc586c898cbc6199` with the full relevant regression matrix green, including live MySQL 8.4 and 9.7 failure-path tests.

## Requirement evidence

| Gate 1 requirement | Implementation / evidence |
| --- | --- |
| Connection lifecycle and TLS | Native connection lifecycle and TCP/TLS negotiation in `lib/Connection.js`; exercised by live MySQL integration tests. |
| `caching_sha2_password` and supported authentication paths | Native auth implementation under `lib/protocol/Auth.js`; contract coverage in `test/auth.js`; live MySQL authentication exercised by `test/live.js`. |
| Simple query execution | Native COM_QUERY path in `lib/Connection.js`; contract coverage in `test/api.js`; live query coverage in `test/live.js`. |
| Prepared statements and typed parameters/results | Native prepared protocol in `lib/PreparedConnection.js` and `lib/protocol/PreparedPackets.js`; coverage in `test/prepared.js` and live integration tests. |
| Transactions and savepoints | `lib/TransactionConnection.js`; exercised by the public API/live integration suite. |
| Bounded connection pooling | `lib/Pool.js` provides connection, queue, idle and acquire bounds; covered by API/live pool tests. |
| Timeout and AbortSignal semantics | Query, prepared, connection and pool operation timeout/cancellation paths are implemented and standardised through the public error model. PR #104 adds live timeout and AbortSignal destruction/replacement proofs. |
| Deterministic resource cleanup | Timed-out/cancelled in-flight operations destroy the physical connection. `test/live-failure-paths.js` proves poisoned connections are not recycled by a one-connection pool on MySQL 8.4 and 9.7. |
| TypeScript declaration surface without a TypeScript release dependency | `index.d.ts` defines the public clean-room API. The package itself has zero dependencies/devDependencies and does not require TypeScript to execute or validate its package-local contracts. |
| Error model and SQLSTATE/native-code preservation | `lib/ErrorModel.js`, `MySqlClientError`, and frozen `ERROR_CODES`; native `MySqlError` numeric code/SQLSTATE is preserved. Covered by `test/error-model.js`. |
| Streaming/backpressure | `lib/ResultStream.js` and `lib/StreamingConnection.js`; bounded row/result limits and socket-level pause/resume; unit and live tests in `test/streaming.js` and `test/live-streaming.js`. |
| Session reset/state required by pooling | `lib/SessionConnection.js` plus pool reset/release behaviour; contract coverage in `test/session-reset.js` and repository session reset/state workflows. |
| Observability using Node/NuBlox primitives only | `lib/Observability.js` uses Node `diagnostics_channel`; zero third-party package dependency; covered by `test/observability.js`. Diagnostic payloads deliberately exclude SQL text, parameter values, credentials, host/database identifiers and error messages. |
| Live MySQL version matrix | Dedicated workflow `.github/workflows/mysql-cleanroom.yml` validates MySQL 8.4 and 9.7. PR #104 additionally made the Node 22/24/26 contract jobs execute the package's canonical `npm test` command. |

## Quality invariants proven during Gate 1

- The clean-room package has no npm dependencies, optional dependencies, peer dependencies or development dependencies.
- Streaming backpressure pauses the underlying socket and restores socket flow on completion.
- Abandoning or resource-limiting an incomplete streamed result does not return an unread protocol connection to the pool.
- Query timeout, AbortSignal cancellation and prepared-execute timeout poison/end the physical connection and force the pool to create a replacement.
- Driver-originated failures expose stable machine-readable error codes while native MySQL server errors preserve server code and SQLSTATE.
- Observability remains constant-memory for streamed results and does not expose query or credential data.
- The dedicated clean-room CI workflow now runs the canonical package test command, so new package-local contract tests cannot be silently omitted by a stale workflow command list.

## Explicitly deferred legacy features

Gate 1 is a production replacement threshold, not a requirement to reproduce every historical legacy-driver feature. Features that are not required for v1 stability remain deferred in accordance with the release plan rather than retaining legacy implementation source indefinitely.

## Next gate

Gate 2 promotes the clean-room runtime to `packages/mysql` / `@nublox/mysql`, removes the legacy mysqljs-derived implementation and lineage files, eliminates legacy package dependencies/tooling, regenerates the dependency graph, and re-establishes release/verification gates against the promoted package.
