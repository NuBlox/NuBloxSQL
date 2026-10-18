# Preserved source archive — evidence-led reuse

**Immutable archive:** [archive/legacy-implementation-2026-10-16](https://github.com/NuBlox/NuBloxSQL/tree/archive/legacy-implementation-2026-10-16), commit **4ed0e35fbfe71ac110c9ec41cf62ba3355e9d56c**, tree **d4cf114ac07cd3128eab645beb6f9721ef62c920**, **635 tracked file blobs**. The branch and active ruleset #25231728 are protected. Never rewrite or delete it.

**Decision:** This historical repository contains substantial NuBloxSQL work. Compare and qualify it **before** rebuilding anything that already exists. Historical module names, self-rated coverage and old tests do **not** establish current production support.

## Source-level audit — 16 October 2026

Reviewed immutable Git tree and selected actual source files, imports, tests, archived package and legacy capability register. The statuses below mean **source evidence**, not live qualification. All paths in this table are relative to the **archive** commit, not current main.

| Capability | Verified archived source paths | Evidence and next action |
| --- | --- | --- |
| PostgreSQL native protocol | lib/dialects/postgresql/lib/Connection.js; protocol/; ScramSha256.js; TlsPolicy.js; PostgreSQL tests | **Top reuse candidate.** First-party Node socket, message and auth code with substantially broader features than the new inventory proof. Compare both implementations, independently execute archived unit suites, review security/TLS/cancellation/types and real-engine tests **before** porting |
| MySQL native protocol | lib/dialects/mysql/lib/Connection.js; lib/protocol/; auth, packet, prepared, test files | **Top reuse candidate.** NuBloxSQL first-party packet/auth logic; assess version-specific authentication, TLS and protocol fidelity |
| SQL Server TDS | lib/dialects/sqlserver/lib/Connection.js; TdsPacket.js; Prelogin.js; Login7.js; Rpc.js; tests | **Candidate.** First-party TDS source; needs supported-version, TLS, login, type-fidelity and live conformance evidence |
| SQLite | lib/dialects/sqlite/lib/Connection.js; maintenance/changeset/storage tests | **Candidate.** Uses the standard Node built-in SQLite API; do not claim that NuBloxSQL developed its own SQLite storage engine |
| Redis RESP2 | lib/dialects/redis/lib/Connection.js; Resp2.js; protocol/live tests | **Candidate.** First-party RESP framing/client source; needs real Redis/security/bounds qualification |
| MongoDB | lib/dialects/mongodb/lib/Connection.js; unit/live tests | **Does not meet first-party wire criterion:** runtime dynamically calls require('mongodb').MongoClient unless a client is injected. Retain learning/tests only; do not adopt as a native NuBloxSQL implementation |
| SQL parser/compiler | lib/capabilities/Parser.js; Compiler.js; AstPipeline.js; ddl/; dml/ | **High-value candidate for query technology.** Contains AST/parser/compiler components; not proof of a complete publicly usable fluent/type-safe query builder |
| Schema intelligence and migrations | lib/client/engineering/SchemaSnapshot.js; SchemaDiff.js; MigrationPlanner.js; MigrationExecutor.js; tests | **High-value candidates.** Audit deterministic models, actual native DDL, loss/risk labelling, dry run, rollback, crash recovery and dialect qualification |
| ORM | No distinct ORM module/package or ORM acceptance suite identified in inspected archived paths | **New capability likely needed.** Some generic model modules refer to SQL capabilities, not object persistence. This source-path finding is not a formal proof of absence |
| Developer query builder | AST/SQL compiler source exists; no separately identifiable fluent builder API/tests in inspected paths | **Independent public API and testing required**, reusing any qualified AST/compiler internals |
| Shell and Workbench | apps/shell/; apps/workbench/; test/working-shell-smoke.js; test/workbench-smoke.js | **Selective UX/workflow reuse.** Historical Workbench is a local web UI, not a proven SvelteKit release; both require fresh contract, security and usability verification |
| Lifecycle and database operations | lib/client/administration/; lib/client/engineering/DataMovement.js; lib/lifecycle/; lib/jobs/ | **Planning/control candidates**, not proof that full installation, recovery and retirement are executable and qualified |
| Technology/vendor/cloud catalogues | lib/catalog/DatabaseTechnologyRegistry.js; CloudDatabaseRegistry.js | **Metadata**, not working wire adapters or cloud IAM/networking qualifications |

The historical [capability register](https://github.com/NuBlox/NuBloxSQL/blob/archive/legacy-implementation-2026-10-16/docs/product/CAPABILITY-REGISTER.md) uses labels such as Strong and Established, but those labels must **not** be carried forward as today's supported-release statements.

### An especially important comparison

Current main has packages/driver/src/postgresql/wire.ts: a deliberately narrow first-party loopback/SCRAM protocol proof. The archive already has broader PostgreSQL connection, wire, TLS, authentication and operation modules. **Do not start another PostgreSQL rewrite before comparing their APIs, correctness, tests and security boundaries.**

## First selective consolidation — native PostgreSQL resource governance

The first consolidation increment compares archived `lib/dialects/postgresql/lib/ResultLimits.js` and `CancellableConnection.js` with current `packages/driver/src/postgresql/wire.ts`.

- **Adopted behaviour:** independent authentication vs query deadlines; an explicit single-operation session lock; per-row (2 MiB), per-query aggregate result (8 MiB) and row-count (1,001) hard limits; fatal disconnect and session invalidation after PostgreSQL ErrorResponse, oversized results or timeout.
- **Reason:** the archive already distinguished result governance and operation timing. The initial native inventory proof had only a row count and a startup timer that accidentally continued throughout the session. An ErrorResponse could otherwise leave unread ReadyForQuery bytes on a seemingly usable session.
- **Proof:** six additional disposable PostgreSQL 17 live acceptance tests exercise idle session survival, query timeout, stale response isolation, same-connection concurrent-call refusal and per-row/aggregate budgets, alongside the existing Driver/Shell tests.
- **Not adopted yet:** archived auxiliary CancelRequest, cancellation recovery state machine, pooling, streaming, Unicode SCRAM/SASLprep or managed-cloud/remote environment qualification. For now an operation timeout **disconnects** instead of promising graceful query cancellation. No archival source tree was mass-imported.
- **Future direction:** compare those advanced archive implementations and integrate one capability at a time under current public API and security tests. These budgets are temporary private-inventory constraints, not universal driver API limits.

This is a **behavioural consolidation of NuBloxSQL-owned concepts**, not a new PostgreSQL implementation or production qualification.

## Second selective consolidation — mandatory verified PostgreSQL TLS

The first-party current `packages/driver/src/postgresql/wire.ts` now incorporates the archived SSLRequest/TlsPolicy **design principles**: a PostgreSQL SSLRequest exchange, exactly-one-byte server response handling, a fail-closed refusal when the server says `N` (or responds with malformed/extra bytes), and mandatory certificate-chain **and hostname/IP identity validation** using Node built-in TLS.

- A disposable real PostgreSQL 17 service with an **ephemerally generated CA and server certificate** verifies native TLS + SCRAM + Driver/Shell inventory.
- CI separately refuses an untrusted CA, a **trusted CA-signed certificate with a mismatched hostname**, and a PostgreSQL server that does not negotiate TLS.
- The standalone Shell supports a PEM trust-anchor path via `NUBLOXSQL_PG_CA_FILE`, only with `verified-tls`; no secrets are placed in command arguments or output.
- This is **transport implementation evidence on disposable fixtures**, not proof of managed-cloud authentication, remote-provider deployment, channel binding or full production readiness. No third-party database client was introduced.
- For direct non-TLS usage, the previously accepted exception remains **isolated loopback only**.

The next native driver consolidation target is graceful auxiliary cancellation and recovery, using the archived CancelRequest logic with actual PostgreSQL 17 cancellation/security tests.

## First MySQL foundation consolidation — still not a connected engine

The private `packages/driver/src/adapters/mysql/protocol.ts` ports the **behavioural design** of archived `PacketFramer.js`, `HandshakeV10.js`, `Auth.js` and `ClientPackets.js` into strict TypeScript with intentionally smaller limits. The new `tests/unit/mysql-protocol.test.mjs` verifies fragmented and sequenced packets, poison-on-invalid framing, handshake plugin/nonce/capability validation, the explicit TLS negotiation request, prohibited LOCAL INFILE/multi-statement flags, supported password challenge algorithms and refusal of cleartext full-authentication without verified TLS.

This is **not yet a live MySQL client**. Limitations are intentional: no large multi-packet result continuation, socket/session management, TLS upgrade and certificate verification, auth switch/full authentication exchange, COM_STMT_PREPARE/EXECUTE or native type decoding. The next increments must reuse and qualify the archive's `PreparedPackets.js`, `StreamingConnection.js` and security policies against disposable actual MySQL servers before adding `mysql` to the public Driver target union.

## Reproducible, read-only reference tests

The [archive assessment workflow](../.github/workflows/archive-assessment.yml) checks out the exact immutable archive commit in a **separate directory** under Node.js 24 and runs selected old PostgreSQL, MySQL, SQL Server, Redis, schema-diff and migration unit suites.

**Passing these tests proves only that the selected archived unit tests run in the CI environment.** It does not prove real-engine protocol compatibility, security, complete vendor/model coverage, ownership provenance or readiness to merge any code. Actual adoption requires current tests and release qualification.

### Read archive files on your Mac without changing branches

~~~bash
nbx nubloxsql
git status --short
git fetch --prune origin
git rev-parse origin/archive/legacy-implementation-2026-10-16
git show 4ed0e35fbfe71ac110c9ec41cf62ba3355e9d56c:lib/dialects/postgresql/lib/Connection.js
git show 4ed0e35fbfe71ac110c9ec41cf62ba3355e9d56c:lib/client/engineering/SchemaDiff.js
~~~

The archive reference must resolve to **4ed0e35fbfe71ac110c9ec41cf62ba3355e9d56c**. These commands read historical data; they do not change the checked-out branch or the archive.

## Required component-by-component reuse gate

1. Link the specific user outcome and capability to [PRODUCT.md](PRODUCT.md), [REQUIREMENTS.md](REQUIREMENTS.md) and a testable professional/developer task.
2. Identify exact archive commit and source paths; check original authorship, dependencies, licence and security assumptions.
3. Run reference tests in isolation; inspect native code and compare with current source. Do not call code qualified merely because unit tests pass.
4. Adapt only justified source into coherent current API boundaries. Never restore the entire archive or smuggle MongoDB or other third-party driver wrappers into first-party runtime.
5. Pass actual DBMS/version/auth/TLS/semantic/negative/live checks, clean consumer builds and regression tests before making support claims.
6. Merge via required PR/CI, verify protected main, preserve immutable archive, record accepted capability evidence.

**The mission remains the full database technology platform**—native drivers, ORM, query builder, schema technologies, professional tools and eventual vendor-aware interoperability—not reconstituting the legacy tree.

## Legacy releases and repository protection

Historical npm v1 releases and licence history are not replaced by reboot builds. New main remains private/unpublished. The main/archive protection installer and verifier are in [admin/README.md](admin/README.md); [issue #328](https://github.com/NuBlox/NuBloxSQL/issues/328) tracks the owner-only enhancement to require the Node/PostgreSQL check on protected main.