# Multi-dialect architecture

## Decision

NuBloxSQL is the umbrella repository for NuBlox SQL connectivity and runtime behaviour across multiple SQL database families.

The repository currently contains the MySQL implementation and publishes it as `@nublox/mysql`. That remains a valid and supported product boundary while the multi-dialect architecture is introduced incrementally.

## Boundary model

The architecture separates four concerns:

1. **portable contracts** — concepts that can be expressed consistently across SQL database families;
2. **dialect services** — SQL syntax, quoting, placeholders and versioned feature support;
3. **adapter runtime** — connection, protocol, authentication, execution and vendor-specific behaviour;
4. **consumer tooling** — products such as NuBlox SQL Workbench that consume adapters without owning transport logic.

```text
Consumer application / SQL Workbench
                │
                ▼
       shared NuBlox SQL contracts
                │
      ┌─────────┼─────────┐
      ▼         ▼         ▼
    MySQL   PostgreSQL   SQLite   ...
      │         │         │
      ▼         ▼         ▼
   server     server    runtime
```

## Non-goals

The shared layer must not:

- force every database into a MySQL-shaped API;
- erase catalog/schema/type distinctions;
- emulate unsupported semantics invisibly;
- standardize vendor features merely by renaming them;
- introduce a universal SQL parser as a prerequisite for connectivity;
- require all dialect adapters to share the same wire-protocol implementation.

## Repository evolution

### Current state

The repository root is the `@nublox/mysql` package. Its current protocol implementation, test suite, release process and API surface are MySQL-specific.

### Transitional state

The repository may temporarily remain a single published package while shared contracts are designed alongside the existing MySQL implementation.

No package split should be performed solely for directory aesthetics. Extraction should happen when the second dialect proves a contract is genuinely reusable.

### Target state

A package family with independent adapter versioning:

```text
packages/
  sql-core/
  mysql/
  postgresql/
  sqlite/
  sqlserver/
  oracle/
```

Possible future workspace layout:

```text
NuBloxSQL/
├── packages/
│   ├── sql-core/
│   ├── mysql/
│   ├── postgresql/
│   ├── sqlite/
│   ├── sqlserver/
│   └── oracle/
├── compatibility/
├── benchmark/
├── docs/
└── test/
```

The package split should be a separately planned migration because the current MySQL package already has consumers and release-candidate history.

## Core contract model

### Dialect identity

Every adapter should expose immutable identity and capability information comparable to:

```ts
interface SqlDialectIdentity {
  family: 'mysql' | 'postgresql' | 'sqlite' | 'sqlserver' | 'oracle' | string;
  name: string;
  serverVersion?: string;
  protocolVersion?: string;
}
```

### Capability discovery

Capabilities must be queryable rather than inferred from package names.

Examples include:

- prepared statements;
- server-side cursors;
- savepoints;
- returning clauses;
- schemas/catalogs;
- generated columns;
- transactional DDL;
- advisory locks;
- query cancellation;
- change-data-capture mechanisms;
- multiple active result sets;
- native JSON/document support.

Capabilities can be version-dependent and connection-dependent.

### Execution result

The portable execution contract should distinguish result categories rather than forcing all outcomes into a row-array shape.

Conceptually:

```ts
type SqlExecutionResult<Row = Record<string, unknown>> =
  | SqlRowsResult<Row>
  | SqlCommandResult
  | SqlMultiResult<Row>;
```

Adapters may expose additional vendor result metadata.

### Metadata model

Portable metadata requires explicit hierarchy. A catalog, database and schema are not interchangeable across vendors.

A neutral object identity should retain all available qualifiers:

```ts
interface SqlObjectName {
  catalog?: string;
  schema?: string;
  name: string;
}
```

Adapters decide how those qualifiers map to their database family.

### Native extensions

Every portable contract should allow adapter-specific extensions without weakening typing or requiring unsafe casts throughout consumers.

The shared layer should define extension points rather than trying to predict every vendor feature centrally.

## Dialect services

SQL text concerns are separate from connectivity.

Each dialect should eventually provide services such as:

```ts
interface SqlDialectServices {
  quoteIdentifier(identifier: string): string;
  placeholder(index: number, name?: string): string;
  supports(feature: SqlFeature): boolean;
}
```

Rendering full migrations, DDL and query ASTs can build on these primitives later. They should not block the initial adapter architecture.

## MySQL boundary

The following existing concerns are inherently MySQL-specific and should remain inside the MySQL adapter:

- classic protocol framing;
- MySQL capability flags;
- `COM_*` command packets;
- `caching_sha2_password` and MySQL authentication plugins;
- MySQL prepared-statement binary protocol;
- MySQL query attributes;
- binlog protocol and GTID handling;
- MySQL server-status flags;
- MySQL compression negotiation;
- MySQL session-state tracking.

Potentially reusable policy includes:

- operation deadline semantics;
- AbortSignal integration contracts;
- pool observability vocabulary;
- transaction orchestration contracts;
- diagnostics event conventions;
- generic resource-limit policy;
- credential-provider shape;
- topology/routing policy interfaces.

These should only move to shared core when a second adapter validates the design.

## PostgreSQL as the abstraction test

PostgreSQL should be the second adapter because it differs from MySQL in enough important areas to expose weak abstractions early:

- `$1`-style parameters instead of `?` placeholders;
- catalogs and schemas with different semantics;
- PostgreSQL-native type OIDs;
- different prepared-statement lifecycle;
- different cancellation protocol;
- different streaming/cursor mechanisms;
- different authentication and TLS details;
- `RETURNING`, arrays, ranges, enums and extension types;
- different replication/CDC facilities.

If a proposed `sql-core` contract cannot support both MySQL and PostgreSQL without awkward exceptions, the contract should be redesigned before additional adapters are added.

## SQL Workbench boundary

NuBlox SQL Workbench should not become the owner of database transports.

Its provider layer should focus on tool-facing operations such as:

- connect/disconnect UX;
- object explorer models;
- editor execution requests;
- metadata presentation;
- schema design and migration workflows;
- administration workflows.

The actual database connection, protocol/runtime semantics and dialect behaviour should come from NuBloxSQL adapters.

Target dependency:

```text
SQL Workbench UI
      ↓
Workbench provider
      ↓
NuBloxSQL adapter
      ↓
Database
```

## Compatibility strategy

Existing ecosystem libraries may be used for behavioural comparison, migration testing and transitional downstream integrations.

NuBloxSQL adapters should ultimately own their public NuBlox runtime surface. Any decision to wrap rather than implement a protocol directly should be explicit per adapter and based on maintenance, licensing, security, performance and platform constraints.

## Migration rules

1. Do not break `@nublox/mysql` to create the abstraction.
2. Do not rename MySQL-specific concepts that remain MySQL-specific.
3. Introduce portable contracts before moving implementation code.
4. Validate contracts against PostgreSQL before declaring them stable shared core.
5. Keep adapter-specific escape hatches first-class.
6. Keep live-server tests per adapter.
7. Keep adapter releases independently versionable once the package split occurs.
8. Move SQL Workbench away from direct third-party-driver dependencies only after the corresponding NuBloxSQL adapter is production-ready.
