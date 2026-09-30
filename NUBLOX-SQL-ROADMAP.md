# NuBloxSQL Roadmap

## Mission

Build NuBloxSQL into the preferred **single-entry SQL database integration platform for developers**: one installation, one import, one coherent API, multiple first-class SQL dialects.

The roadmap advances two things together:

1. **public platform maturity** — the quality of the one-entry developer API, capability model and shared contracts;
2. **native runtime depth** — how completely each database dialect is implemented and qualified.

A dialect is not complete merely because it can execute `SELECT 1`, and NuBloxSQL is not complete merely because several internal packages exist.

## Public platform target

The intended developer experience is:

```bash
npm install nubloxsql
```

```js
const sql = require('nubloxsql');
const db = sql.createConnection({ dialect: 'postgresql', ...config });
```

The internal dialect workspaces remain implementation boundaries. Developers should not need to install a separate driver package for each supported dialect.

## Current dialect state

| Dialect | Status | Runtime model |
| --- | --- | --- |
| MySQL | Stable | Native client/server runtime |
| PostgreSQL | Stable | Native client/server runtime |
| SQLite | Development | Embedded runtime |
| SQL Server | Planned | Native client/server runtime |
| Oracle | Planned | Native client/server runtime |

## Phase 0 — Stable native baseline — complete

The first stable baseline established:

- SQL Core contract family `1.0`;
- stable native MySQL runtime;
- stable native PostgreSQL runtime;
- zero-third-party npm package boundary for stable runtime implementation;
- Node.js 22/24/26 verification;
- MySQL 8.4/9.7 live qualification;
- PostgreSQL 15/16/17/18 live qualification;
- proprietary release gates, fuzzing and CodeQL.

## Phase 1 — Single-entry NuBloxSQL facade — active

Make the root `nubloxsql` package the canonical public product.

### Initial facade

- one install and one import;
- explicit dialect selection;
- `createConnection(...)` routing;
- `createPool(...)` routing where supported;
- adapter/native access from the same installation;
- capability and descriptor discovery;
- shared SQL Core access;
- root TypeScript declarations;
- root packaging that contains supported runtimes;
- facade contract tests and package dry-run validation.

### Facade slices

1. ✅ connection-string/URL dialect selection where semantics are unambiguous;
2. ✅ consistent async lifecycle conventions across networked and embedded engines;
3. ✅ platform-level connection and pool configuration validation;
4. ✅ stable public error surface for facade/routing failures;
5. ✅ richer capability discovery, including server/runtime-specific capabilities;
6. ✅ public metadata/introspection entry points;
7. ✅ public transaction helper policy where genuinely portable;
8. observability conventions across dialects;
9. TypeScript discrimination and inference by dialect;
10. stable release qualification for the single-entry package.

## Phase 2 — Shared contracts — continuous

SQL Core remains an internal contract foundation. New portable concepts must be proven by multiple real dialects before promotion.

Priority areas include:

- richer metadata/introspection vocabulary;
- capability scoping;
- observability vocabulary;
- richer result metadata where genuinely portable;
- topology/routing policy only when multiple networked dialects justify it;
- consistent native extension conventions.

Do not change SQL Core merely to make one dialect easier to implement.

## Phase 3 — SQLite — active

SQLite is the current dialect-depth priority because it pressure-tests NuBloxSQL against embedded-database semantics.

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
- SQL Core descriptor/capability integration.

### Next SQLite slices

1. schema introspection: indexes, index expressions, partial indexes, composite foreign keys, primary/unique metadata and raw CREATE SQL where required;
2. database lifecycle: backup, serialization/deserialization where supported, restore and explicit open-mode semantics;
3. attached databases: ATTACH/DETACH and namespace semantics;
4. type/schema semantics: affinity, STRICT tables, generated columns and WITHOUT ROWID;
5. storage/concurrency: WAL, journal, synchronous and busy/locking policy;
6. extensibility: application-defined functions/aggregates and session/changeset support where appropriate;
7. production qualification: observability, memory/performance evidence, malformed-input hardening and release gates.

## Phase 4 — SQL Server — planned

Key areas:

- TDS transport;
- authentication strategy;
- SQL Server types and metadata;
- schema/security concepts;
- transactions/isolation;
- prepared execution;
- cancellation;
- pooling;
- multiple-active-result semantics where implemented;
- observability/diagnostics;
- supported-version qualification.

SQL Server must integrate through the same public `nubloxsql` entry point.

## Phase 5 — Oracle — planned

Key areas:

- connectivity/client strategy;
- service/session model;
- authentication/TLS/client-library implications;
- NUMBER/DATE/TIMESTAMP/LOB fidelity;
- PL/SQL and routine metadata;
- schema ownership/security semantics;
- prepared execution and bind behaviour;
- pooling/cancellation;
- observability;
- supported-version qualification.

Oracle must integrate through the same public `nubloxsql` entry point.

## Later dialect candidates

Potential future dialects include MariaDB, CockroachDB, DB2 and other SQL-family engines. No support claim exists until a runtime is implemented, integrated into the NuBloxSQL facade and qualified.

## Quality bar for every stable dialect

A stable dialect must demonstrate:

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
- performance/memory evidence;
- explicit capability metadata;
- native extension access through NuBloxSQL;
- proprietary-source/release-boundary compliance.

## Product-level success condition

NuBloxSQL succeeds when a developer can choose it as their **single SQL integration dependency** across database families and retain both a coherent common API and first-class access to each engine's native power.
