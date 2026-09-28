# NuBloxSQL Multi-Dialect Roadmap

## Purpose

NuBloxSQL is an independent database connectivity and SQL runtime platform supporting multiple SQL database families through a shared set of contracts with independently evolvable dialect adapters.

The existing `@nublox/mysql` package remains the first production adapter and must retain its current release-candidate compatibility while the common platform is extracted incrementally.

## Architectural direction

NuBloxSQL is not intended to become one lowest-common-denominator driver. The target model is:

```text
NuBloxSQL
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

The preferred long-term package family is:

```text
@nublox/sql-core
@nublox/mysql
@nublox/postgresql
@nublox/sqlite
@nublox/sqlserver
@nublox/oracle
```

`@nublox/sql-core` must contain contracts and reusable policy only. It must not become a transport implementation and must not require every adapter to emulate features that the target database does not support.

The current `@nublox/mysql` package remains unchanged until the shared contracts are mature enough to extract without breaking its public API.

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

NuBloxSQL should expose dialect services separately from transport:

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

1. expose the common contracts where semantics genuinely align;
2. expose first-class adapter extensions for vendor-specific capabilities;
3. never silently emulate unsupported server behaviour when that changes semantics;
4. identify the connected database family and version explicitly;
5. expose capability metadata so callers can branch intentionally;
6. maintain its own live-server CI matrix;
7. maintain migration/compatibility documentation for established ecosystem drivers where useful.

## Initial adapter sequence

### A1 — MySQL

Status: production foundation already exists as `@nublox/mysql`.

Priorities:

- finish advanced MySQL capabilities;
- identify reusable contracts without prematurely moving protocol code;
- publish common contract tests that MySQL can implement first.

### A2 — PostgreSQL

Priorities:

- native PostgreSQL connection and execution surface;
- PostgreSQL type mapping;
- cancellation and transaction semantics;
- catalog/schema introspection;
- prepared statements and cursor/streaming semantics;
- TLS/authentication coverage;
- live CI against supported PostgreSQL releases.

Direct `pg` usage in consuming applications should be treated as transitional once this adapter reaches production readiness.

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

## Migration phases

### Phase 0 — Preserve MySQL RC

- keep `@nublox/mysql` package name and current public API stable;
- do not rename MySQL-specific files merely for symmetry;
- introduce architecture and capability vocabulary first.

### Phase 1 — Define shared contracts

Create `@nublox/sql-core` only after contracts are backed by at least MySQL plus one second dialect design.

The first contract set should cover:

- database/dialect identity;
- capabilities;
- connection/session lifecycle;
- execution results;
- transactions;
- cancellation/timeouts;
- quoting/placeholders;
- metadata/introspection.

### Phase 2 — PostgreSQL adapter

Implement PostgreSQL against the shared contracts and use the differences discovered there to harden the abstractions.

### Phase 3 — Extract reusable MySQL policy

Move only genuinely portable policy from `@nublox/mysql` into `@nublox/sql-core`.

Protocol packets, MySQL authentication, MySQL binary encodings, binlog logic and MySQL-specific server-state handling stay in `@nublox/mysql`.

### Phase 4 — Additional dialects

Add SQLite, SQL Server and Oracle once the common contracts have survived both MySQL and PostgreSQL production requirements.

## Independence principle

NuBloxSQL must remain independently usable, testable, versionable and releasable. Its architecture and roadmap must not depend on any other NuBlox product or application.

Consumers may integrate NuBloxSQL through its public package APIs, but no external project is part of NuBloxSQL's internal architecture, release criteria or product definition.

## Acceptance criteria for the shared core

A capability belongs in `@nublox/sql-core` only when:

- its semantics can be expressed without lying about database behaviour;
- at least two dialects can implement the contract meaningfully, or it is clearly a cross-dialect policy abstraction;
- vendor-specific information can still be represented without lossy flattening;
- tests define the portable behaviour;
- adapters can opt out through explicit capability metadata when the database does not support it.

## Relationship to the MySQL roadmap

`NUBLOX-MYSQL-ROADMAP.md` remains the implementation roadmap for the MySQL adapter.

This document governs the repository-level direction and the eventual family of NuBlox SQL packages.
