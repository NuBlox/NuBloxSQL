# NuBloxSQL Multi-Dialect Roadmap

## Purpose

NuBloxSQL is an independent database connectivity and SQL runtime platform supporting multiple SQL database families through shared contracts and independently evolvable dialect adapters.

`@nublox/mysql` remains the first production adapter and retains its release-candidate compatibility. The repository itself is now a private multi-package workspace rather than the MySQL package root.

## Architectural direction

NuBloxSQL is not a lowest-common-denominator driver. The platform model is:

```text
NuBloxSQL workspace
├── shared SQL contracts
├── execution/session abstractions
├── transactions and cancellation
├── pooling and resilience contracts
├── metadata/introspection contracts
├── type-system contracts
├── diagnostics/observability contracts
│
├── MySQL adapter
├── PostgreSQL adapter
├── SQLite adapter
├── SQL Server adapter
└── Oracle adapter
```

Dialect-specific protocols, authentication, wire formats, server features and operational semantics remain inside their adapters.

## Package model

The package family is:

```text
@nublox/sql-core
@nublox/mysql
@nublox/postgresql
@nublox/sqlite       # planned
@nublox/sqlserver    # planned
@nublox/oracle       # planned
```

`@nublox/sql-core` contains contracts and reusable policy only. It must not become a transport implementation and must not require every adapter to emulate features that the target database does not support.

The repository root is private workspace orchestration. Public runtime packages live under `packages/` and are independently versioned and publishable.

## Platform contracts

The shared layer should converge on the following capability groups.

### Connections and sessions

- connection lifecycle;
- session identity and state;
- connection validation and health;
- reset/reuse semantics;
- credentials and secure transport policy;
- feature/capability discovery.

### Execution

- text execution;
- parameterized execution;
- prepared execution where supported;
- statement/result metadata;
- streaming/iteration;
- operation deadlines;
- cancellation;
- result/resource limits.

### Transactions

- begin/commit/rollback;
- isolation-level contracts;
- savepoints where supported;
- retry classification and policy hooks;
- transaction-scoped connections.

### Pooling and resilience

- acquisition and release;
- capacity and admission control;
- health and saturation telemetry;
- failover/routing hooks;
- topology awareness where applicable;
- driver-specific reset/reuse implementation.

### Metadata and introspection

- catalogs/databases;
- schemas/namespaces;
- tables/views;
- columns;
- indexes;
- keys and constraints;
- routines/functions/procedures;
- users/roles/privileges where available;
- engine/vendor-specific extension metadata.

### Type system

- portable logical value categories;
- adapter-owned native database type identifiers;
- explicit conversion policies;
- precision/scale/length metadata;
- date/time/time-zone semantics;
- binary and large-object semantics;
- JSON/document values where supported;
- vendor-extension escape hatches.

### SQL dialect services

NuBloxSQL exposes dialect services separately from transport:

- identifier quoting;
- placeholder rendering;
- literal rendering when explicitly required;
- DDL capability metadata;
- migration rendering primitives;
- feature detection;
- reserved-word awareness;
- database-version capability matrices.

## Adapter principles

Each adapter must:

1. expose common contracts only where semantics genuinely align;
2. expose first-class adapter extensions for vendor-specific capabilities;
3. never silently emulate unsupported server behaviour when that changes semantics;
4. identify the connected database family and version explicitly;
5. expose capability metadata so callers can branch intentionally;
6. maintain its own live-server CI matrix where a server runtime applies;
7. maintain migration/compatibility documentation for established ecosystem drivers where useful;
8. own its protocol and security boundary independently of other adapters.

## Adapter sequence

### A1 — MySQL

Status: production foundation and release candidate exist as `@nublox/mysql` under `packages/mysql`.

Priorities:

- continue advanced MySQL capabilities;
- preserve compatibility and performance;
- extract reusable policy only when another dialect validates it;
- keep MySQL protocol implementation isolated inside the adapter.

### A2 — PostgreSQL

Status: dialect foundation exists as `@nublox/postgresql` under `packages/postgresql`.

Next priorities:

- native PostgreSQL startup/TLS/authentication protocol;
- native connection and execution surface;
- PostgreSQL type mapping;
- cancellation and transaction semantics;
- catalog/schema introspection;
- prepared statements and cursor/streaming semantics;
- live CI against supported PostgreSQL releases;
- replication/change-data-capture capabilities after core query runtime matures.

### A3 — SQLite

Priorities:

- embedded/local runtime model;
- transaction and locking semantics;
- schema introspection;
- file/database lifecycle;
- type-affinity-aware mappings.

### A4 — SQL Server

Priorities:

- TDS transport decision and implementation strategy;
- integrated/SQL authentication strategy;
- SQL Server type and metadata model;
- transaction/isolation behaviour;
- schema/security introspection.

### A5 — Oracle

Priorities:

- Oracle connectivity strategy;
- service/session model;
- NUMBER/DATE/TIMESTAMP/LOB mappings;
- PL/SQL/routine metadata;
- schema/security introspection;
- operational constraints around native client/runtime dependencies if required.

## Delivery phases

### Phase 0 — Preserve MySQL RC — complete

- `@nublox/mysql` package name and public API preserved;
- MySQL-specific protocol concepts remain MySQL-specific;
- regression, compatibility and live-server CI remain mandatory.

### Phase 1 — Establish shared contracts — foundation complete

`@nublox/sql-core` now provides the first portable dialect identity, capability, execution/result, transaction, error, metadata, quoting and placeholder contracts.

Further contracts graduate only after multi-dialect validation.

### Phase 2 — Establish second dialect — foundation complete

`@nublox/postgresql` now provides the second dialect model and validates SQL Core against PostgreSQL semantics.

### Phase 3 — Multi-package workspace — complete

The repository root is private platform orchestration and the public packages are siblings under `packages/`.

This phase must preserve `@nublox/mysql` behaviour and release identity while removing the historical assumption that the repository itself is a MySQL package.

### Phase 4 — PostgreSQL native runtime — next

Implement PostgreSQL protocol connectivity in vertical slices:

1. framing and backend message parser;
2. startup and SSL negotiation;
3. authentication, including SCRAM-SHA-256;
4. session parameters and ReadyForQuery state;
5. simple query execution;
6. extended query protocol and prepared statements;
7. cancellation, deadlines and error classification;
8. pooling, streaming/cursors and observability;
9. metadata/introspection and type system;
10. live compatibility/performance hardening.

### Phase 5 — Harden shared policy

Move only genuinely portable policy from adapters into `@nublox/sql-core` after both MySQL and PostgreSQL implementations prove the abstraction.

Protocol packets, vendor authentication, binary encodings, replication logic and vendor-specific server state always remain in their adapters.

### Phase 6 — Additional dialects

Add SQLite, SQL Server and Oracle after the shared contracts have survived real MySQL and PostgreSQL runtime requirements.

## World-leading quality bar

Every production adapter should target:

- protocol correctness against supported server versions;
- secure modern authentication and TLS;
- callback and Promise ergonomics where appropriate;
- strong TypeScript contracts;
- prepared execution and streaming/cursor support where the database supports them;
- cancellation and deadline semantics;
- robust pooling and lifecycle management;
- resource limits and defensive parsing;
- portable observability and adapter-native diagnostics;
- deterministic error classification;
- comprehensive compatibility tests against established ecosystem drivers;
- live multi-version CI;
- performance and memory regression benchmarks;
- zero silent semantic emulation across dialects;
- independent package release and provenance controls.

## Independence principle

NuBloxSQL remains independently usable, testable, versionable and releasable. Its architecture and roadmap do not depend on any other NuBlox product or application.

Consumers integrate through published package APIs; no external project is part of NuBloxSQL's internal architecture, release criteria or product definition.

## Acceptance criteria for shared core

A capability belongs in `@nublox/sql-core` only when:

- its semantics can be expressed without lying about database behaviour;
- at least two dialects can implement the contract meaningfully, or it is clearly a cross-dialect policy abstraction;
- vendor-specific information can still be represented without lossy flattening;
- tests define the portable behaviour;
- adapters can opt out through explicit capability metadata when the database does not support it.

## Relationship to adapter roadmaps

Adapter-specific roadmaps belong with their packages. `packages/mysql/NUBLOX-MYSQL-ROADMAP.md` remains the implementation roadmap for the MySQL adapter.

This document governs repository-level architecture, quality standards and the NuBloxSQL package family.
