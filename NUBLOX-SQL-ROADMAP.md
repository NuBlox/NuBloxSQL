# NuBloxSQL Roadmap

## Current baseline

NuBloxSQL v1.0.0 established the stable three-package baseline:

| Package | Version | Status |
| --- | ---: | --- |
| `@nublox/sql-core` | `1.0.0` | Stable |
| `@nublox/mysql` | `1.0.0` | Stable |
| `@nublox/postgresql` | `1.0.0` | Stable |

The current post-v1 development package is `@nublox/sqlite@0.1.0`.

## Development principles

Every adapter must:

1. implement shared contracts only where semantics genuinely align;
2. expose native extensions for vendor-specific behaviour;
3. report unsupported semantics explicitly rather than emulate them silently;
4. preserve deterministic resource and lifecycle safety;
5. maintain independent package, test and release evidence;
6. remain compatible with SQL Core contract family `1.0` unless a deliberate major contract revision is approved.

## A1 — MySQL

**Status:** stable `@nublox/mysql@1.0.0`.

Post-v1 priorities:

- broader protocol and type coverage;
- richer metadata/introspection;
- resilience and observability hardening;
- compatibility/performance evidence across supported MySQL versions;
- advanced replication/change-data-capture only where independently authored and supportable.

## A2 — PostgreSQL

**Status:** stable `@nublox/postgresql@1.0.0`.

Post-v1 priorities:

- deeper catalog/schema introspection;
- expanded native type and binary-format coverage;
- richer observability and diagnostics;
- prepared-statement/portal performance hardening;
- replication/change-data-capture after the query runtime remains mature.

## A3 — SQLite

**Status:** active development, `@nublox/sqlite@0.1.0`.

Implemented foundation:

- `node:sqlite` embedded runtime with no third-party npm dependency;
- in-memory and file-backed lifecycle;
- prepared statements and BigInt-safe reads;
- DEFERRED, IMMEDIATE and EXCLUSIVE transaction modes;
- savepoints, rollback-to-savepoint and release;
- busy timeout and foreign-key policy;
- optional query-only mode;
- row/result resource limits;
- deterministic SQLite error classification;
- database, table/view and column introspection;
- SQL Core v1 descriptor compatibility.

Next slices, in order:

1. index, foreign-key and constraint introspection;
2. backup, serialization and restore lifecycle;
3. ATTACH/DETACH database management;
4. type-affinity and STRICT-table helpers;
5. WAL/journal/synchronous locking policy;
6. application-defined function/aggregate registration policy;
7. changeset/session support where appropriate;
8. observability and performance/memory evidence;
9. malformed SQL/configuration hardening and extension-loading safety;
10. release-candidate qualification.

## A4 — SQL Server

**Status:** planned after SQLite hardening.

Primary workstreams:

- TDS transport;
- authentication strategy;
- SQL Server type system and metadata;
- transactions/isolation semantics;
- schema/security introspection;
- cancellation, pooling and diagnostics.

## A5 — Oracle

**Status:** planned.

Primary workstreams:

- connectivity/runtime dependency strategy;
- service/session model;
- NUMBER/DATE/TIMESTAMP/LOB mappings;
- PL/SQL and routine metadata;
- schema/security introspection;
- pooling, cancellation and operational constraints.

## Cross-dialect workstream

Cross-dialect policy evolves continuously, but only after real adapters prove portability. Protocol packets, authentication, binary encodings, server/session state and SQLite storage/locking rules remain adapter-owned.

## Quality bar

A stable adapter should have:

- qualified runtime/database versions;
- secure transport/authentication where applicable;
- strong TypeScript contracts;
- prepared execution where supported;
- explicit transaction and locking semantics;
- cancellation/deadline behaviour where genuinely available;
- defensive resource limits;
- deterministic error classification;
- metadata and type fidelity;
- observability and adapter-native diagnostics;
- multi-version CI or equivalent qualification;
- performance and memory evidence;
- independent package/release provenance controls.

## Release sequencing

1. **Stable v1 baseline** — complete.
2. **Protect SQL Core contract family 1.0** — continuous.
3. **SQLite vertical hardening** — active.
4. **SQL Server** — follows SQLite qualification.
5. **Oracle** — follows connectivity-strategy validation.

Release-specific historical evidence is kept under `docs/v1/`; this roadmap is the authoritative source for current forward development.
