# NuBloxSQL Roadmap

## Mission

Build NuBloxSQL into the NuBlox-owned SQL connectivity and database-runtime platform for multiple database families, suitable for direct application use and as the database substrate beneath products such as NuBlox SQL Workbench.

The roadmap must advance two things together:

1. **native runtime depth** for each database family;
2. **platform quality** in the shared contracts, metadata model, capability model, diagnostics and consumer integration surface.

A new dialect is not complete merely because it can execute `SELECT 1`.

## Platform state

| Component | Version | Status | Role |
| --- | ---: | --- | --- |
| `@nublox/sql-core` | `1.0.0` | Stable | Portable platform contracts |
| `@nublox/mysql` | `1.0.0` | Stable | Native MySQL runtime |
| `@nublox/postgresql` | `1.0.0` | Stable | Native PostgreSQL runtime |
| `@nublox/sqlite` | `0.1.0` | Development | Embedded SQLite runtime |
| `@nublox/sqlserver` | — | Planned | Native SQL Server runtime |
| `@nublox/oracle` | — | Planned | Native Oracle runtime |

## Architectural programme

Every delivery wave should improve the following platform dimensions where relevant:

- connectivity/session lifecycle;
- execution and prepared execution;
- transactions/savepoints;
- cancellation/deadlines;
- streaming/cursors/iteration;
- metadata and introspection;
- type fidelity;
- errors and diagnostics;
- resource limits;
- observability;
- security hardening;
- supported-version evidence;
- consumer-facing capability discovery;
- native extension surfaces.

## Phase 0 — Stable v1 baseline — complete

NuBloxSQL v1.0.0 established:

- SQL Core contract family `1.0`;
- stable native MySQL runtime;
- stable native PostgreSQL runtime;
- zero-third-party npm package boundary for the stable packages;
- Node.js 22/24/26 verification;
- MySQL 8.4/9.7 live qualification;
- PostgreSQL 15/16/17/18 live qualification;
- proprietary release gates, fuzzing and CodeQL.

## Phase 1 — Protect and extend the platform contract — continuous

SQL Core `1.0` is stable. New portable concepts must be proven by real adapters before promotion.

Current platform concerns to evolve carefully include:

- richer metadata/introspection vocabulary;
- capability scoping by runtime/server state;
- observability vocabulary;
- topology/routing policy only when multiple networked adapters justify it;
- richer result metadata where genuinely portable;
- consumer-facing connection/metadata patterns needed by SQL Workbench.

Do not change SQL Core merely to make one adapter easier to implement.

## Phase 2 — SQLite — active

SQLite is the current priority because it tests NuBloxSQL against embedded-database semantics rather than another client/server engine.

### Completed foundation

- `node:sqlite` runtime integration;
- in-memory and file-backed databases;
- prepared statements;
- BigInt-safe INTEGER reads;
- DEFERRED/IMMEDIATE/EXCLUSIVE transactions;
- savepoints;
- busy timeout and foreign-key policy;
- query-only mode;
- row/result resource limits;
- deterministic error classification;
- database/table/view/column introspection;
- SQL Core dialect/capability integration.

### Next SQLite slices

1. **Schema introspection**
   - indexes;
   - index columns/expressions/partial indexes;
   - foreign keys, including composites;
   - primary-key/unique metadata;
   - raw CREATE SQL where normalized CHECK/constraint metadata cannot be represented safely.

2. **Database lifecycle**
   - backup;
   - serialization/deserialization where supported;
   - restore workflows;
   - file/query-only/open-mode semantics.

3. **Attached databases**
   - ATTACH/DETACH management;
   - explicit `main`/`temp`/attached namespace behaviour;
   - safe identifier/literal handling.

4. **Type and schema semantics**
   - affinity helpers;
   - STRICT tables;
   - generated columns and WITHOUT ROWID considerations;
   - fidelity rules for INTEGER/REAL/TEXT/BLOB/NULL.

5. **Storage and concurrency policy**
   - WAL/journal modes;
   - synchronous policy;
   - busy handling;
   - locking/concurrency documentation and APIs.

6. **Extensibility**
   - application-defined functions;
   - aggregates;
   - session/changeset support where appropriate;
   - extension loading disabled by default and security-reviewed before any exposure.

7. **Production qualification**
   - observability;
   - memory/performance evidence;
   - malformed-input/configuration hardening;
   - package/API review;
   - release-candidate gates.

## Phase 3 — SQL Workbench integration contract — evolve alongside adapters

NuBlox SQL Workbench is a major intended consumer.

NuBloxSQL should supply the runtime and semantic data that Workbench providers need, including:

- connection lifecycle;
- capability discovery;
- execution requests/results;
- metadata/object discovery;
- transaction state;
- cancellation/resource-limit behaviour;
- native adapter extensions for administration features.

Workbench should own presentation and workflows, not database transports.

Do not couple NuBloxSQL to Workbench UI code; define reusable runtime/provider contracts instead.

## Phase 4 — SQL Server — planned

SQL Server is the next networked dialect after SQLite reaches sufficient maturity.

Key engineering areas:

- TDS transport;
- authentication strategy, including enterprise/integrated-auth constraints;
- SQL Server types and metadata;
- schema/security concepts;
- transactions/isolation;
- prepared execution;
- cancellation;
- pooling;
- multiple-active-result semantics where implemented;
- observability and diagnostics;
- supported SQL Server version matrix.

SQL Server should pressure-test platform assumptions around enterprise authentication, metadata/security and concurrent results.

## Phase 5 — Oracle — planned

Key engineering areas:

- client/connectivity strategy;
- service/session model;
- authentication/TLS/client-library implications;
- NUMBER/DATE/TIMESTAMP/LOB fidelity;
- PL/SQL and routine metadata;
- schema ownership/security semantics;
- prepared execution and bind behaviour;
- pooling/cancellation;
- observability;
- supported Oracle version matrix.

Oracle should pressure-test platform assumptions around client dependencies, session state, type fidelity and schema ownership.

## Later dialect candidates

Additional adapters should be selected based on product need and how much they improve NuBloxSQL's platform coverage. Candidates may include MariaDB, CockroachDB, DB2 and other SQL-family engines, but no support claim exists until a package is implemented and qualified.

## Quality bar for every stable adapter

A stable adapter should demonstrate:

- correct lifecycle behaviour;
- secure authentication/transport where applicable;
- prepared execution where supported;
- transaction/savepoint correctness;
- explicit cancellation semantics;
- resource limits and deterministic cleanup;
- metadata/introspection depth appropriate to the engine;
- type fidelity;
- structured errors/diagnostics;
- observability;
- multi-version CI/live qualification;
- failure-path/security testing;
- performance and memory evidence;
- explicit capability metadata;
- native extension APIs where portable contracts are insufficient;
- proprietary-source/release-boundary compliance.

## Product-level success condition

NuBloxSQL succeeds when a sophisticated consumer such as NuBlox SQL Workbench can target multiple SQL database families through one NuBlox-owned runtime architecture **without losing the ability to expose each database engine's native power**.

That is the standard against which future design decisions should be judged.
