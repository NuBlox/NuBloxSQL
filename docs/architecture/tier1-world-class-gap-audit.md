# Tier-1 World-Class Gap Audit

## Purpose

This register is the authoritative development-direction document for NuBloxSQL Tier-1 dialects: PostgreSQL, MySQL and SQLite.

NuBloxSQL is a standalone, application-agnostic SQL/database platform. The audit evaluates runtime/database capability: connection lifecycle, authentication and transport, prepared execution, transactions, streaming, cancellation, resource governance, metadata, type fidelity, diagnostics, observability, failure recovery, engine-native workflows and live qualification.

Status vocabulary:

- **qualified** — implemented and covered by repository/live qualification appropriate to the feature;
- **implemented** — code exists but qualification is not yet sufficient to call the area qualified;
- **partial** — useful support exists but important native behaviour remains;
- **missing** — no first-class NuBloxSQL runtime implementation is present;
- **not applicable** — the concept does not apply to the engine/runtime model.

Priority vocabulary:

- **P0** — required for the current world-class Tier-1 baseline;
- **P1** — important first-class engine depth;
- **P2** — advanced/specialist functionality that can follow the baseline.

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
| Portable metadata/introspection | qualified | qualified baseline | qualified deep |
| Native deep metadata | qualified | partial | qualified deep |
| Type fidelity | qualified core | qualified core | qualified core |
| Structured errors | qualified | qualified | qualified |
| Observability | qualified baseline | qualified baseline | qualified baseline |
| Native query diagnostics | qualified | partial | qualified deep |
| Bulk data movement | qualified COPY streaming | qualified LOCAL INFILE import | engine-specific alternatives qualified |
| Event/notification integration | qualified LISTEN/NOTIFY | no direct analogue | not applicable |
| Replication/CDC-native integration | missing | missing | session changesets implemented, not CDC |
| Performance/memory evidence | qualified baseline | qualified baseline | partial |
| Failure/adversarial qualification | qualified baseline | qualified baseline | strong, further stress desirable |

## Current direction

PostgreSQL has completed every **current P0 runtime-depth item** in this register. MySQL has now closed its P0 LOCAL INFILE/bulk-import gap. Development priority moves to the remaining MySQL P0 items, then SQLite production qualification, then shared Tier-1 evidence/contracts.

1. MySQL P0: structured EXPLAIN, deep metadata, authentication-plugin qualification.
2. SQLite P0: benchmark/performance, memory, concurrency and malformed-schema/input evidence.
3. Shared Tier-1: richer metadata parity, diagnostics parity and stable evidence register.
4. Re-run formal stable qualification against this register before expanding compiler grammar again.

---

# PostgreSQL

## Qualified P0 baseline

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
- deterministic type decoding/fidelity policy;
- native `COPY FROM STDIN` and `COPY TO STDOUT` streaming;
- native `LISTEN`/`NOTIFY` asynchronous notifications;
- structured `EXPLAIN` / `EXPLAIN ANALYZE` JSON diagnostics;
- deep PostgreSQL catalog introspection;
- PostgreSQL 15, 16, 17 and 18 live qualification;
- Node 22/24/26 contract qualification;
- security/fuzz/release gates.

### Completed P0 slices

| Area | Status | Evidence/outcome |
| --- | --- | --- |
| COPY FROM STDIN | qualified | Streaming producer API with backpressure, cancellation, byte limits, failure recovery and pool qualification across PostgreSQL 15–18. |
| COPY TO STDOUT | qualified | Bounded collection or streaming sink, backpressure, byte accounting, cancellation and pool qualification across PostgreSQL 15–18. |
| LISTEN/NOTIFY | qualified | Protocol-level notifications, connection APIs and session-correct pooled subscriptions. |
| Structured EXPLAIN | qualified | JSON plans, parameterized diagnostics, normalized factual metrics and version-aware PostgreSQL 15–18 options. |
| Deep catalog introspection | qualified | Table/column/index/constraint internals, partition topology, RLS policies, routines, custom types/domains/enums/ranges, sequences and visible privileges qualified on PostgreSQL 15–18. |

## Remaining PostgreSQL depth

These are P1/P2 enhancements, not blockers for the current P0 baseline:

| Area | Status | Priority | Required outcome |
| --- | --- | --- | --- |
| Logical replication protocol | missing | P1 | Replication-mode startup, WAL/LSN primitives and explicit slot/publication workflow boundaries. |
| Server/session diagnostics | partial | P1 | `pg_stat_activity`, locks, waits and query-state helpers without pretending they are portable SQL. |
| Binary format breadth | partial | P1 | Expand binary encode/decode support for high-value native types where it improves fidelity/performance. |
| Arrays/ranges/composites/domain fidelity | partial | P1 | Deterministic codecs and explicit fallback behaviour. |
| Prepared statement/cache policy | partial | P1 | Explicit cache limits, invalidation behaviour and observability. |
| Large objects | missing | P2 | Add only if justified separately from `bytea` and COPY workflows. |
| Failover/topology policy | missing | P2 | Add after shared network-topology semantics are justified across dialects. |

### PostgreSQL completion gate

**Current P0 gate: complete.** PostgreSQL remains regression-gated across supported Node and PostgreSQL versions. P1/P2 work can proceed without reopening the completed P0 declaration unless a regression or new baseline requirement is identified.

---

# MySQL

## Strong foundation

NuBloxSQL already provides native protocol framing/authentication, prepared statements, typed binds, direct/prepared streaming with backpressure, pooling/reset contracts, transactions/savepoints, operation deadlines/cancellation, result limits, observability/error modelling, portable metadata, MySQL 8.4/9.7 live qualification, Node 22/24/26 contracts and security/release gates.

### Completed P0 slices

| Area | Status | Evidence/outcome |
| --- | --- | --- |
| LOAD DATA LOCAL INFILE | qualified | Explicit opt-in `CLIENT_LOCAL_FILES`, caller-supplied streaming sources only, exact server filename validation, byte ceilings, backpressure, timeout/abort safety, pooled operation and live MySQL 8.4/9.7 qualification. |

## Remaining gaps

| Area | Status | Priority | Required outcome |
| --- | --- | --- | --- |
| Rich EXPLAIN API | partial | P0 | `EXPLAIN FORMAT=JSON` / `EXPLAIN ANALYZE` capture with structured diagnostics and version qualification. |
| Deep INFORMATION_SCHEMA metadata | partial | P0 | Functional/invisible/full-text/spatial indexes, generated columns, partitions, routines, triggers/events, users/roles/privileges and engine options. |
| Authentication plugin breadth | partial | P0 | Explicit supported-plugin matrix and failure tests for modern server defaults and TLS-dependent auth paths. |
| Bulk export helpers | missing | P1 | Safe engine-native export workflow where filesystem/server semantics permit it. |
| Server/session diagnostics | partial | P1 | Performance Schema/sys-backed helpers with explicit privilege requirements. |
| Replication/binlog protocol | missing | P1 | Optional replication-client boundary, GTID/binlog-position primitives and event framing. |
| Compression | missing/unclear | P1 | Implement and qualify protocol compression or explicitly declare unsupported. |
| Multi-result/stored program depth | partial | P1 | Multiple-result sequencing, OUT parameters/routine workflows and cleanup guarantees. |
| Native JSON/spatial fidelity | partial | P1 | Explicit codecs/metadata for high-value native values where feasible. |
| Failover/topology/routing | missing | P2 | Add only after shared topology semantics are justified. |

### MySQL completion gate

MySQL remains Stable. Three current P0 items remain before its world-class Tier-1 runtime-depth gate is complete: structured EXPLAIN, deep metadata and authentication-plugin matrix closure.

---

# SQLite

## Strong foundation

SQLite has the broadest engine-native management surface in NuBloxSQL: embedded `node:sqlite`, lifecycle modes, prepared execution, transactions/savepoints, attached databases, backup/serialization, deep schema introspection, WAL/storage policy, integrity/maintenance APIs, extension/security policy, feature probes, query diagnostics, changesets and resource governance.

## Remaining gaps

| Area | Status | Priority | Required outcome |
| --- | --- | --- | --- |
| Production performance evidence | partial | P0 | Repeatable prepared/unprepared read/write, transaction, materialization and metadata benchmarks. |
| Memory evidence | partial | P0 | Large-result and long-lived connection memory ceilings with regression thresholds. |
| Concurrency stress | partial | P0 | WAL/rollback-journal contention, busy-timeout, checkpoint and writer-starvation tests. |
| Malformed database/schema hardening | partial | P0 | Corrupt/malformed schema and hostile metadata cases with deterministic failures/no crashes. |
| Interrupt/cancellation surface | partial | P1 | Expose stable host interrupt semantics if available; otherwise document the limitation. |
| Incremental row consumption | partial | P1 | Avoid mandatory full materialization where the host iterator API permits streaming consumption. |
| Backup/restore stress | implemented | P1 | Large-file, attached-database and failure/recovery qualification. |
| Session changeset stress | implemented | P1 | Larger changesets, conflict storms, filters and transactional failure tests. |
| FTS/RTree helper APIs | missing | P2 | Add only where first-class helpers improve the standalone API beyond raw SQL/capability discovery. |

### SQLite completion gate

SQLite should move from Development to Stable only after the four P0 operational-evidence items above are complete.

---

# Cross-dialect gaps

| Area | Priority | Required outcome |
| --- | --- | --- |
| Metadata parity | P0 | Define a richer portable catalog vocabulary and prove it across PostgreSQL/MySQL/SQLite without hiding native detail. PostgreSQL and SQLite now provide deep native surfaces; MySQL remains the primary gap. |
| Explain/diagnostics parity | P0 | Common entry point with native plan payloads and conservative normalized fields. PostgreSQL and SQLite are qualified; MySQL remains. |
| Benchmark harness | P0 | Reproducible latency/throughput/memory scenarios with machine-readable evidence and regression thresholds. |
| Failure matrix | P0 | Authentication, TLS, timeout, cancellation, malformed protocol/input, resource exhaustion and cleanup invariants. |
| Stability evidence register | P0 | Per-dialect checklist linking each stable criterion to tests/workflows/docs. |
| Native extension convention | P1 | Consistent discoverability of engine-specific APIs without bloating the portable interface. |
| Capability-to-runtime coverage | P1 | Identify capability-model leaves that describe engine features but have no corresponding runtime/helper contract. |

---

# Build order

## Wave 1 — PostgreSQL native workflows — COMPLETE CURRENT P0

1. ~~COPY FROM STDIN~~ — **qualified**
2. ~~COPY TO STDOUT~~ — **qualified**
3. ~~LISTEN/NOTIFY~~ — **qualified**
4. ~~Structured EXPLAIN/EXPLAIN ANALYZE~~ — **qualified**
5. ~~Deep catalog introspection~~ — **qualified**

## Wave 2 — MySQL native workflows — IN PROGRESS

1. ~~LOAD DATA LOCAL INFILE with strict security policy~~ — **qualified**
2. **Structured EXPLAIN/EXPLAIN ANALYZE — NEXT.**
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
2. Cross-dialect diagnostics contract.
3. Stable evidence register.
4. Final release qualification and documentation reconciliation.

## Deferred while Waves 2–4 are active

The SQL AST/compiler foundation remains regression-tested, but grammar expansion is paused. CTE/subquery/DML/DDL transpilation work resumes only after the current Tier-1 runtime P0 programme is complete.
