# Gate 4 Evidence — SQL Core v1 Stabilisation

Gate 4 freezes the first stable cross-dialect contract family for NuBloxSQL.

## Evidence basis

The contract is derived from the two canonical production-oriented adapters:

- `@nublox/mysql` — native NuBlox MySQL implementation;
- `@nublox/postgresql` — native NuBlox PostgreSQL implementation.

The gate does not promote abstractions merely because they existed in the earlier SQL Core prototype.

## Frozen shared concepts

The v1 contract freezes:

- dialect identity and capability discovery;
- identifier quoting and positional placeholder services;
- catalog/schema/name object identity;
- structural cancellation signals;
- relative operation timeout vocabulary;
- bounded result controls: rows, total result bytes and row bytes;
- positional execution parameters;
- row-result and command-result vocabulary;
- portable field metadata plus explicit vendor extension space;
- transaction isolation and read-only policy;
- portable error categories including state and resource-limit failures;
- native code / SQLSTATE / retryability / cause preservation;
- adapter extension points.

## Concepts explicitly rejected from the v1 freeze

The Gate 4 contract suite asserts that SQL Core v1 does not freeze:

- generic named parameter maps;
- generic multi-result containers;
- universal absolute deadlines.

Additional vendor-specific concepts remain outside SQL Core, including native cursor/portal packet models, CDC/replication, authentication and native type codecs.

## Runtime and package evidence

The Gate 4 branch establishes:

- `CONTRACT_VERSION === '1.0'`;
- `@nublox/sql-core@1.0.0-rc.1`;
- zero package dependencies;
- Node.js 22/24/26 SQL Core contract execution;
- package dry-run validation;
- a repository-level adapter contract that exercises both canonical adapters;
- MySQL `?` and PostgreSQL `$1` placeholder semantics without normalising them away;
- MySQL and PostgreSQL schema/cancellation capability differences remaining explicit.

## Stability rule

The compatibility contract is documented in `docs/v1/SQL-CORE-V1-CONTRACT.md`.

After stable `@nublox/sql-core@1.0.0`, breaking changes to the frozen contract require a new major version. Adapter-only additive APIs do not require SQL Core changes unless the portable contract itself changes.

## Gate decision

Gate 4 may be marked complete only when the branch's full repository regression matrix is green. At that point Gate 5 becomes the sole v1 critical path: final proprietary/release audit, stable package versions, licence finalisation, packaging evidence, migration/support documentation and release freeze.
