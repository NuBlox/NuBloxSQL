# Tier-1 World-Class Gap Audit

## Purpose

This register is the authoritative development-direction document for NuBloxSQL Tier-1 dialects: PostgreSQL, MySQL and SQLite.

The objective is not merely to expose the SQL language features each engine supports. NuBloxSQL must provide a production-quality runtime around those engines: connection lifecycle, authentication/transport, prepared execution, transactions, streaming, cancellation, resource governance, metadata, type fidelity, diagnostics, observability, failure recovery, engine-native workflows and live qualification.

The SQL capability model remains valuable, but it describes what the database engine can do. This audit separately records what NuBloxSQL itself currently implements and qualifies.

NuBloxSQL is a standalone, application-agnostic SQL/database platform. This audit therefore evaluates database/runtime capability only and does not depend on, reference requirements from, or assume any consuming application.

Status vocabulary:

- **qualified** — implemented and covered by repository/live qualification appropriate to the feature;
- **implemented** — code exists, but production/live qualification is not yet complete enough to call the area qualified;
- **partial** — useful support exists, but important engine-native behaviour is still missing;
- **missing** — no first-class NuBloxSQL runtime implementation was found in the current repository;
- **not applicable** — the concept does not apply to the engine/runtime model.

Priority vocabulary:

- **P0** — required before the dialect should be described as world-class;
- **P1** — important first-class engine depth;
- **P2** — advanced/specialist functionality that can follow the world-class baseline.

## Executive position

| Runtime area | PostgreSQL | MySQL | SQLite |
| --- | --- | --- | --- |
| Connection lifecycle | qualified | qualified | qualified |
| Secure transport/authentication | qualified | qualified | host/embedded |
| Prepared execution | qualified | qualified | qualified |
| Transactions/savepoints | qualified | qualified | qualified |
| Pooling | qualified | qualified | not applicable |
| Streaming/backpressure | qualified | qualified | partial |
| Cancellation/deadlines | qualified | qualified | host-limited/partial |
| Result/resource limits | qualified | qualified | qualified |
| Portable metadata/introspection | qualified baseline | qualified baseline | qualified deep |
| Type fidelity | qualified core | qualified core | qualified core |
| Structured errors | qualified | qualified | qualified |
| Observability | qualified baseline | qualified baseline | qualified baseline |
| Native query diagnostics | qualified | partial | qualified deep |
| Bulk data movement | qualified COPY streaming | missing | engine-specific alternatives qualified |
| Event/notification integration | qualified LISTEN/NOTIFY | not applicable as direct analogue | not applicable |
| Replication/CDC-native integration | missing | missing | session changesets implemented, not CDC |
| Engine-native administrative workflows | strong/partial | partial | qualified deep |
| Performance/memory evidence | qualified baseline | qualified baseline | partial |
| Failure/adversarial qualification | qualified baseline | qualified baseline | strong, further stress desirable |

The immediate programme should therefore continue runtime-depth work in this order:

1. Finish PostgreSQL P0 runtime depth with deep catalog introspection.
2. Close MySQL P0 runtime gaps: LOCAL INFILE/bulk movement, structured diagnostics, deep metadata and authentication-plugin qualification.
3. Complete SQLite production qualification: stress, memory/performance, malformed-schema/input and concurrency evidence.
4. Build shared Tier-1 metadata/diagnostic/stability evidence where common contracts are justified without erasing native semantics.
5. Re-run formal stable qualification against this register and only then expand compiler grammar again.

---

# PostgreSQL

## Strong/qualified foundation

Current repository evidence demonstrates a substantial native PostgreSQL runtime:

- native wire protocol and authentication;
- SCRAM-SHA-256 and TLS paths;
- extended query protocol;
- prepared statements and typed values;
- portal/cursor-style streaming;
- connection pooling and transaction-safe pool reuse;
- CancelRequest-based cancellation and deadline handling;
- transaction/savepoint helpers;
- result/resource limits;
- portable metadata/introspection;
- deterministic type decoding/fidelity policy;
- native `COPY FROM STDIN` and `COPY TO STDOUT` streaming with backpressure, cancellation, limits, pool safety and failure recovery;
- native `LISTEN`/`NOTIFY` asynchronous notifications with session-correct pooled subscriptions;
- structured `EXPLAIN` / `EXPLAIN ANALYZE` JSON diagnostics with version-aware PostgreSQL 15–18 options;
- PostgreSQL 15, 16, 17 and 18 live qualification;
- Node 22/24/26 contract qualification;
- security/fuzz/release gates.

These are genuine strengths and should remain regression-gated.

## Completed P0 runtime-depth slices

| Area | Status | Evidence/outcome |
| --- | --- | --- |
| COPY FROM STDIN | qualified | Streaming producer API with backpressure, cancellation, byte limits, failure recovery and pool qualification across PostgreSQL 15–18. |
| COPY TO STDOUT | qualified | Bounded collection or streaming sink, backpressure, byte accounting, cancellation and pool qualification across PostgreSQL 15–18. |
| LISTEN/NOTIFY | qualified | Protocol-level NotificationResponse handling, connection APIs and a dedicated pooled subscription that pins one physical session until close. |
| Rich EXPLAIN API | qualified | JSON plans, parameterized diagnostics, normalized factual metrics, pooled operation and version gates for PostgreSQL 16/17/18 additions. |

## Remaining gaps

| Area | Status | Priority | Required outcome |
| --- | --- | --- | --- |
| Deep catalog introspection | partial | P0 | Index expressions/predicates, generated/identity details, partitions, policies, routines, types/domains/enums, sequences and privileges. |
| Logical replication protocol | missing | P1 | Replication-mode startup, WAL/LSN primitives and explicit slot/publication workflow boundaries. |
| Server/session diagnostics | partial | P1 | pg_stat_activity/locks/waits/query-state helpers without pretending they are portable SQL. |
| Binary format breadth | partial | P1 | Expand binary encode/decode support for high-value PostgreSQL native types where it improves fidelity/performance. |
| Arrays/ranges/composites/domain fidelity | partial | P1 | Deterministic decoding/encoding contracts and explicit fallback behaviour. |
| Large objects | missing | P2 | Large-object API only if justified separately from bytea/COPY workflows. |
| Prepared statement/cache policy | partial | P1 | Explicit lifecycle/cache limits, invalidation behaviour and observability. |
| Failover/topology policy | missing | P2 | Only after a portable topology abstraction is justified across networked dialects. |

## PostgreSQL completion gate

PostgreSQL should not receive a new “world-class Tier-1” declaration until the remaining P0 item is implemented, live-qualified on supported server versions where relevant, and included in failure-path/security tests. The next P0 deliverable is deep catalog introspection.

---

# MySQL

## Strong/qualified foundation

Current repository evidence demonstrates a mature native MySQL runtime:

- native protocol framing and authentication;
- prepared statements and typed binds;
- direct and prepared streaming with backpressure;
- connection pooling and reuse/reset contracts;
- transactions/savepoints;
- operation deadlines/cancellation safety;
- result limits and connection safety after limit failures;
- observability and deterministic error modelling;
- portable metadata/introspection baseline;
- MySQL 8.4 and 9.7 live qualification;
- Node 22/24/26 contract qualification;
- security/fuzz/release gates.

## Gaps

| Area | Status | Priority | Required outcome |
| --- | --- | --- | --- |
| LOAD DATA LOCAL INFILE | missing | P0 | Explicit opt-in local infile API, stream/path policy, security boundaries, cancellation and server capability checks. |
| Bulk export helpers | missing | P1 | Safe engine-native export workflow where server/filesystem semantics permit it. |
| Rich EXPLAIN API | partial | P0 | EXPLAIN FORMAT=JSON / EXPLAIN ANALYZE capture with structured diagnostics and version qualification. |
| Deep INFORMATION_SCHEMA metadata | partial | P0 | Functional/invisible/full-text/spatial indexes, generated columns, partitions, routines, triggers/events, users/roles/privileges and engine options. |
| Server/session diagnostics | partial | P1 | Performance Schema/sys-backed helpers with explicit privilege requirements. |
| Replication/binlog protocol | missing | P1 | Optional dedicated replication client boundary, GTID/binlog-position primitives and event framing; do not label this portable CDC. |
| Authentication plugin breadth | partial | P0 | Explicit supported-plugin matrix and failure tests for modern server defaults and TLS-dependent auth paths. |
| Compression | missing/unclear | P1 | Either implement and qualify negotiated protocol compression or explicitly declare unsupported and remove ambiguity. |
| Multi-result/stored program depth | partial | P1 | Multiple-result sequencing, OUT parameter/routine workflows and cleanup guarantees. |
| Session-state/reset depth | qualified baseline | P1 | Extend reset verification to more server/session variables and temporary/prepared state. |
| Native JSON/spatial fidelity | partial | P1 | Explicit codecs/metadata for high-value native values instead of generic text/binary fallback where feasible. |
| Failover/topology/routing | missing | P2 | Add only after shared topology semantics are justified with PostgreSQL. |

## MySQL completion gate

MySQL is already strong enough to remain Stable, but “world-class Tier-1” should require P0 gaps above to be closed and the supported authentication/transport matrix to be explicit and live-tested.

---

# SQLite

## Strong/qualified foundation

SQLite currently has the broadest engine-native management surface in NuBloxSQL:

- embedded `node:sqlite` integration;
- read/write/open modes and query-only policy;
- prepared execution and BigInt-safe reads;
- transactions/savepoints;
- attached databases;
- backup and serialization/deserialization capability detection;
- deep schema introspection;
- generated/STRICT/WITHOUT ROWID metadata;
- WAL/journal/synchronous/busy/cache/page policy;
- checkpointing and storage diagnostics;
- integrity/foreign-key checks, ANALYZE, optimize, VACUUM and incremental vacuum;
- scalar functions and aggregate registration;
- extension loading policy and allowlisting;
- authorizer/defensive-mode capability detection;
- JSON/JSONB/FTS/SQL feature runtime probes;
- query plans, opcode EXPLAIN and statement diagnostics;
- session changesets/patchsets and conflict handling;
- runtime/resource limits and hardened profiles;
- Node 22/24/26 qualification.

## Gaps

| Area | Status | Priority | Required outcome |
| --- | --- | --- | --- |
| Production performance evidence | partial | P0 | Repeatable benchmark suite for prepared/unprepared reads/writes, transactions, streaming/materialization and metadata operations. |
| Memory evidence | partial | P0 | Large-result and long-lived-connection memory ceilings with regression thresholds. |
| Concurrency stress | partial | P0 | Multi-connection WAL/rollback-journal contention, busy-timeout, checkpoint and writer-starvation tests. |
| Malformed database/schema hardening | partial | P0 | Corrupt/malformed schema and hostile metadata cases with deterministic failures/no crashes. |
| Interrupt/cancellation surface | partial | P1 | Expose host-supported interrupt semantics if `node:sqlite` provides a stable capability; otherwise document the hard limitation explicitly. |
| Incremental/streaming row consumption | partial | P1 | Avoid mandatory full materialization for large reads where the host API permits iterator-based consumption. |
| Backup/restore stress | implemented | P1 | Large-file, attached-db and failure/recovery qualification. |
| Extension sandbox expectations | qualified policy | P1 | Continue explicit documentation that native extensions are trusted code, not sandboxed plugins. |
| Session changeset stress | implemented | P1 | Larger changesets, conflict storms, filters and transactional failure tests. |
| FTS/RTree helper APIs | missing | P2 | Add first-class helpers only if they improve the standalone SQL/database API beyond raw SQL and capability discovery. |

## SQLite completion gate

SQLite should move from Development to Stable only after the P0 production-qualification work is complete. Feature breadth alone is no longer the blocker; operational evidence is.

---

# Cross-dialect gaps

These are shared platform gaps that matter more than adding another SQL syntax feature.

| Area | Priority | Required outcome |
| --- | --- | --- |
| Metadata parity | P0 | Define a richer portable catalog vocabulary and prove it against PostgreSQL/MySQL/SQLite without hiding native detail. |
| Explain/diagnostics contract | P0 | Common entry point with native plan payloads and conservative normalized fields; never erase vendor semantics. PostgreSQL and SQLite now provide qualified native diagnostic surfaces; MySQL remains to be completed. |
| Benchmark harness | P0 | Reproducible latency/throughput/memory scenarios with machine-readable evidence and regression thresholds. |
| Failure matrix | P0 | Authentication, TLS, timeout, cancellation, malformed protocol/input, resource exhaustion and cleanup invariants. |
| Stability evidence register | P0 | Per-dialect checklist linking each stable criterion to tests/workflows/docs. |
| Native extension convention | P1 | Consistent discoverability of engine-specific APIs without bloating the portable interface. |
| Capability-to-runtime coverage | P1 | Identify capability-model leaves that describe engine features but have no corresponding NuBloxSQL helper/runtime contract. |

---

# Build order

## Wave 1 — PostgreSQL native workflows

1. ~~COPY FROM STDIN.~~ **qualified**
2. ~~COPY TO STDOUT.~~ **qualified**
3. ~~LISTEN/NOTIFY.~~ **qualified**
4. ~~Structured EXPLAIN/EXPLAIN ANALYZE.~~ **qualified**
5. **Deep catalog introspection — NEXT.**

## Wave 2 — MySQL native workflows

1. LOAD DATA LOCAL INFILE with a strict security policy.
2. Structured EXPLAIN/EXPLAIN ANALYZE.
3. Deep INFORMATION_SCHEMA/Performance Schema metadata.
4. Authentication-plugin support matrix closure.
5. Decide and document protocol compression support.

## Wave 3 — SQLite stable qualification

1. Benchmark/performance harness.
2. Memory qualification.
3. WAL/contention stress.
4. Malformed-schema/input hardening.
5. Backup/changeset stress.

## Wave 4 — Shared Tier-1 stable evidence

1. Rich metadata contract.
2. Cross-dialect explain/diagnostics contract.
3. Stable evidence register.
4. Final release qualification and documentation reconciliation.

## Deferred while Waves 1–4 are active

The SQL AST/compiler foundation remains in NuBloxSQL and continues to be regression-tested, but grammar expansion is paused. CTE/subquery/DML/DDL transpilation work resumes only after the Tier-1 runtime P0 gaps above are closed.
