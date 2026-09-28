# Multi-dialect architecture

## Decision

NuBloxSQL is an independent multi-package repository for SQL connectivity and runtime behaviour across multiple SQL database families.

The repository root is private workspace orchestration. Public runtime packages are independently versioned under `packages/`.

## Boundary model

The architecture separates three concerns:

1. **portable contracts** — concepts that can be expressed consistently across SQL database families;
2. **dialect services** — SQL syntax, quoting, placeholders and versioned feature support;
3. **adapter runtime** — connection, protocol, authentication, execution and vendor-specific behaviour.

```text
          @nublox/sql-core
                  │
        ┌─────────┼─────────┐
        ▼         ▼         ▼
      MySQL   PostgreSQL   future dialects
        │         │
        ▼         ▼
     protocol   protocol
     runtime    runtime
```

NuBloxSQL exposes public package APIs for consumers, but consumer applications are outside the NuBloxSQL architecture and release boundary.

## Non-goals

The shared layer must not:

- force every database into a MySQL-shaped API;
- erase catalog/schema/type distinctions;
- emulate unsupported semantics invisibly;
- standardize vendor features merely by renaming them;
- introduce a universal SQL parser as a prerequisite for connectivity;
- require all dialect adapters to share the same wire-protocol implementation.

## Repository structure

The workspace is structured as:

```text
NuBloxSQL/
├── packages/
│   ├── sql-core/
│   ├── mysql/
│   ├── postgresql/
│   └── future-dialects/
├── docs/
├── test/
└── package.json
```

Current public package boundaries are:

- `@nublox/sql-core` — vendor-neutral contracts and dialect primitives;
- `@nublox/mysql` — the existing MySQL driver, including its protocol implementation and release history;
- `@nublox/postgresql` — the PostgreSQL dialect foundation, with protocol runtime development following this architecture.

Future adapters such as SQLite, SQL Server and Oracle belong beside these packages rather than at repository root.

The workspace root is private and must never become a substitute runtime package for an individual adapter.

## Core contract model

### Dialect identity

Every adapter exposes immutable identity and capability information comparable to:

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

The portable execution contract distinguishes result categories rather than forcing all outcomes into a row-array shape.

```ts
type SqlExecutionResult<Row = Record<string, unknown>> =
  | SqlRowsResult<Row>
  | SqlCommandResult
  | SqlMultiResult<Row>;
```

Adapters may expose additional vendor result metadata.

### Metadata model

Portable metadata requires explicit hierarchy. A catalog, database and schema are not interchangeable across vendors.

```ts
interface SqlObjectName {
  catalog?: string;
  schema?: string;
  name: string;
}
```

Adapters decide how those qualifiers map to their database family.

### Native extensions

Portable contracts allow adapter-specific extensions without weakening typing or forcing vendor features into shared core.

## Dialect services

SQL text concerns remain separate from connectivity. Dialects provide primitives such as identifier quoting, parameter placeholders and capability discovery. Full DDL/query rendering can build on those primitives without becoming a prerequisite for driver connectivity.

## MySQL boundary

The following concerns remain MySQL-specific inside `packages/mysql`:

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

Potentially reusable policy includes operation deadlines, AbortSignal contracts, observability vocabulary, transaction orchestration, diagnostics conventions, resource-limit policy, credential-provider shape and topology/routing interfaces. These move to shared core only when another adapter validates the abstraction.

## PostgreSQL as the second reference dialect

PostgreSQL is the second reference dialect because it differs materially from MySQL in parameter syntax, catalog/schema semantics, type OIDs, prepared-statement lifecycle, cancellation, cursors, authentication, TLS and replication.

The PostgreSQL dialect foundation already validates shared identity, capability, quoting, placeholder and object-name contracts. Protocol development must continue to pressure-test the shared contracts rather than copy MySQL implementation patterns.

If a proposed `sql-core` contract cannot support both MySQL and PostgreSQL without awkward exceptions, redesign the contract before adding further adapters.

## Independence boundary

NuBloxSQL is independently usable, testable, versionable and releasable.

Its architecture, source tree, runtime contracts, CI, release criteria and roadmap must not depend on any other NuBlox project. External consumers integrate only through NuBloxSQL's published package APIs and are not part of its internal design.

## Compatibility strategy

Existing ecosystem libraries may be used for behavioural comparison, migration testing and transitional integrations.

NuBloxSQL adapters should ultimately own their public runtime surface. Any decision to wrap rather than implement a protocol directly must be explicit per adapter and based on maintenance, licensing, security, performance and platform constraints.

## Architecture rules

1. Keep the repository root private and platform-focused.
2. Keep every public adapter independently versionable and publishable.
3. Do not break `@nublox/mysql` to create shared abstractions.
4. Do not rename vendor-specific concepts merely to make them appear portable.
5. Validate shared contracts against more than one dialect before stabilising them.
6. Keep adapter-specific escape hatches first-class.
7. Keep live-server tests per networked adapter.
8. Keep protocol implementations isolated by dialect.
9. Keep NuBloxSQL architecture and release decisions independent of external consumer projects.
