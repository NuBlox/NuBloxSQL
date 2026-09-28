# NuBloxSQL Multi-Dialect Roadmap

## Purpose

NuBloxSQL is an independent database connectivity and SQL runtime platform for multiple SQL database families. Portable contracts live in `@nublox/sql-core`; protocol, storage, locking, authentication and vendor-specific behaviour stay inside each adapter.

NuBloxSQL does not force databases into a lowest-common-denominator abstraction. Capabilities are explicit so consumers can branch intentionally when semantics differ.

## Package family

```text
@nublox/sql-core       stable 1.0 contract
@nublox/mysql          stable 1.0 native driver
@nublox/postgresql     stable 1.0 native driver
@nublox/sqlite         post-v1 development
@nublox/sqlserver      planned
@nublox/oracle         planned
```

The repository root is private workspace orchestration. Public runtime packages live under `packages/` and remain independently versioned and publishable.

## Platform architecture

```text
NuBloxSQL workspace
├── shared SQL contracts
├── execution/result contracts
├── transactions and savepoints
├── resource limits and cancellation contracts
├── metadata/introspection contracts
├── type-system contracts
├── diagnostics/observability contracts
│
├── MySQL native adapter
├── PostgreSQL native adapter
├── SQLite embedded adapter
├── SQL Server adapter
└── Oracle adapter
```

## Adapter principles

Every adapter must:

1. implement shared contracts only where semantics genuinely align;
2. expose first-class native extensions for vendor-specific capabilities;
3. never silently emulate unsupported behaviour when semantics would change;
4. identify its database family and runtime/version explicitly;
5. publish explicit capability metadata;
6. preserve resource limits and deterministic failure classification;
7. keep transport/storage-specific implementation isolated from SQL Core;
8. maintain independent package, test and release evidence.

## A1 — MySQL

**Status:** stable `@nublox/mysql@1.0.0`.

The v1 driver owns its MySQL wire protocol, authentication, prepared execution, transactions, streaming/resource controls and operational error model.

Post-v1 priorities:

- broader protocol and type coverage;
- richer metadata/introspection;
- resilience and observability hardening;
- compatibility/performance evidence across supported MySQL versions;
- advanced replication/change-data-capture only where it remains independently authored and supportable.

## A2 — PostgreSQL

**Status:** stable `@nublox/postgresql@1.0.0`.

The v1 driver includes native startup/authentication, SCRAM-SHA-256, query execution, prepared/portal execution, cancellation, transactions, pooling, result limits and deterministic type decoding.

Post-v1 priorities:

- deeper catalog/schema introspection;
- expanded native type registry and binary-format coverage;
- richer observability and operational diagnostics;
- prepared statement/portal performance hardening;
- replication/change-data-capture after the query runtime is mature.

## A3 — SQLite

**Status:** foundation implemented as `@nublox/sqlite@0.1.0` development package.

Initial foundation:

- Node.js `node:sqlite` embedded runtime with no third-party npm dependency;
- file-backed and in-memory database lifecycle;
- prepared statements and BigInt-safe reads;
- explicit DEFERRED, IMMEDIATE and EXCLUSIVE transaction modes;
- savepoints, rollback-to-savepoint and release;
- busy timeout and foreign-key policy;
- optional query-only mode;
- row/result resource limits;
- deterministic SQLite error classification;
- database, table/view and column introspection;
- SQL Core v1 dialect descriptor compatibility.

Next SQLite slices:

1. index, foreign-key and constraint introspection;
2. backup, serialization and restore lifecycle;
3. ATTACH/DETACH database management;
4. type-affinity and STRICT-table helpers;
5. WAL/journal/synchronous locking policy;
6. application-defined function/aggregate registration policy;
7. changeset/session support where appropriate;
8. observability and performance/memory evidence;
9. hardening against malformed SQL/configuration and unsafe extension loading;
10. release-candidate qualification.

## A4 — SQL Server

**Status:** planned after SQLite foundation hardening.

Priorities:

- TDS transport architecture;
- SQL and integrated authentication strategy;
- SQL Server type system and metadata;
- transactions/isolation semantics;
- schema/security introspection;
- cancellation, pooling and operational diagnostics.

## A5 — Oracle

**Status:** planned.

Priorities:

- connectivity/runtime dependency strategy;
- service/session model;
- NUMBER/DATE/TIMESTAMP/LOB mappings;
- PL/SQL and routine metadata;
- schema/security introspection;
- pooling, cancellation and operational constraints.

## Delivery phases

### Phase 0 — Stable v1 baseline — complete

- `@nublox/mysql@1.0.0`;
- `@nublox/postgresql@1.0.0`;
- `@nublox/sql-core@1.0.0`;
- proprietary zero-third-party package boundary;
- Node 22/24/26 verification and release evidence.

### Phase 1 — Protect the v1 contract — continuous

SQL Core contract family `1.0` is frozen for compatible evolution. New adapters validate the contract; they do not mutate it merely to simplify their implementation.

### Phase 2 — SQLite embedded adapter — active

Build SQLite vertically from runtime correctness through lifecycle, introspection, locking policy, diagnostics and release qualification.

### Phase 3 — Cross-dialect policy hardening — active alongside adapters

Promote policy into SQL Core only after multiple real adapters prove that the semantics are genuinely portable. Protocol packets, authentication, binary encodings, vendor server state and SQLite storage/locking rules remain adapter-owned.

### Phase 4 — SQL Server

Start TDS and authentication work after the SQLite adapter has validated embedded-database semantics against the common contracts.

### Phase 5 — Oracle

Select and validate an Oracle connectivity strategy without contaminating the shared core with client-library-specific assumptions.

## World-class quality bar

Every production adapter should target:

- correctness against qualified database/runtime versions;
- secure authentication and transport where applicable;
- strong TypeScript contracts;
- prepared execution and streaming/iteration where supported;
- explicit transaction and locking semantics;
- cancellation/deadline behaviour where genuinely available;
- defensive resource limits;
- deterministic error classification;
- metadata and type fidelity;
- observability and adapter-native diagnostics;
- multi-version CI or runtime qualification;
- performance and memory regression evidence;
- zero silent cross-dialect semantic emulation;
- independent package release and provenance controls.

## SQL Core acceptance rule

A capability belongs in `@nublox/sql-core` only when:

- its semantics can be expressed without misrepresenting database behaviour;
- at least two dialects can implement it meaningfully, or it is clearly portable policy;
- vendor-specific information remains representable without lossy flattening;
- tests define the portable behaviour;
- unsupported behaviour is visible through capability metadata rather than hidden emulation.

## Independence

NuBloxSQL remains independently usable, testable, versionable and releasable. Consumers integrate through published package APIs; no other NuBlox application is part of its internal architecture or release criteria.
