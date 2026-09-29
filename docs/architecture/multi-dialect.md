# NuBloxSQL Multi-Dialect Architecture

## Architectural decision

NuBloxSQL is the umbrella runtime for SQL connectivity and database semantics across multiple database families.

It is composed of independently versioned packages, but those packages implement one platform architecture. Package independence exists for release and compatibility management; it does not imply unrelated product intent.

## Layer model

NuBloxSQL separates four concerns.

### Layer 1 — Platform contracts

`@nublox/sql-core` defines concepts that are safe to share across database families:

- dialect identity and capability discovery;
- portable object naming and metadata vocabulary;
- execution/result categories;
- transaction policy vocabulary;
- cancellation/timeout vocabulary;
- resource limits;
- error categories and native diagnostic preservation;
- extension points for adapter-native information.

### Layer 2 — Dialect services

Each adapter owns SQL-family semantics such as:

- identifier quoting;
- parameter placeholders;
- feature/version support;
- catalog/schema mapping;
- type-system rules;
- engine-specific SQL behaviour.

Dialect services expose these differences deliberately rather than hiding them.

### Layer 3 — Adapter runtime

Each database adapter owns its actual runtime implementation.

For MySQL and PostgreSQL this includes network protocol, authentication, TLS, session lifecycle, execution, prepared statements, cancellation, pooling and server diagnostics.

For SQLite this includes the embedded runtime, database lifecycle, transaction modes, locking/storage policy and SQLite-specific introspection.

Future SQL Server and Oracle adapters will own their corresponding native runtime semantics.

### Layer 4 — Consumer integration

Consumers such as NuBlox SQL Workbench sit above NuBloxSQL.

```text
NuBlox SQL Workbench / application
               │
               ▼
   consumer provider/service layer
               │
               ▼
           NuBloxSQL
               │
      ┌────────┼────────┐
      ▼        ▼        ▼
    MySQL   PostgreSQL SQLite ...
```

Consumers own product workflows and presentation. NuBloxSQL owns database transport/runtime behaviour.

## Repository structure

```text
NuBloxSQL/
├── packages/
│   ├── sql-core/       # portable platform contracts
│   ├── mysql/          # native MySQL runtime
│   ├── postgresql/     # native PostgreSQL runtime
│   └── sqlite/         # embedded SQLite runtime
├── docs/
│   ├── architecture/
│   └── v1/
├── test/
├── tool/
└── package.json
```

Planned packages:

```text
packages/sqlserver/
packages/oracle/
```

## Platform contract rules

A concept belongs in SQL Core only when all of the following are true:

1. the semantics can be stated without misrepresenting a supported database family;
2. at least two real adapters prove the abstraction, or it is clearly portable policy;
3. vendor-specific detail can still be represented through extension space;
4. unsupported behaviour remains explicit;
5. tests define the portable contract.

If an adapter does not fit cleanly, the first question is whether the abstraction is wrong — not how to force the adapter into it.

## Native-runtime rules

Every adapter must:

1. preserve the database engine's real semantics;
2. expose explicit capability metadata;
3. own its native transport/storage implementation boundary;
4. retain native error/diagnostic information;
5. fail deterministically under configured resource limits;
6. avoid silent semantic emulation;
7. provide native extension points where portable contracts are insufficient;
8. remain independently versionable, testable and releasable;
9. meet the NuBloxSQL evidence bar before claiming stable support.

## Database-family boundaries

### MySQL

MySQL-owned concerns include classic protocol framing, authentication plugins, prepared-statement binary protocol, session status, streaming/backpressure and MySQL transaction/session semantics.

### PostgreSQL

PostgreSQL-owned concerns include frontend/backend protocol, SCRAM, BackendKeyData/CancelRequest, portals, OID-based types, PostgreSQL schema/catalog semantics and PostgreSQL transaction state.

### SQLite

SQLite-owned concerns include embedded lifecycle, transaction modes, savepoints, attached databases, type affinity/STRICT semantics, PRAGMA-based metadata, journal/WAL/synchronous policy and file/storage locking.

### SQL Server

SQL Server will pressure-test TDS, integrated authentication, SQL Server metadata/security concepts, MARS-like semantics, isolation behaviour and enterprise administration requirements.

### Oracle

Oracle will pressure-test service/session semantics, NUMBER/DATE/TIMESTAMP/LOB fidelity, PL/SQL metadata, schema ownership and client/runtime dependency strategy.

## Metadata architecture

NuBloxSQL must preserve hierarchy instead of assuming that `database`, `catalog` and `schema` mean the same thing everywhere.

Portable object identity therefore retains qualifiers:

```ts
interface SqlObjectName {
  catalog?: string;
  schema?: string;
  name: string;
}
```

Adapters determine which qualifiers are meaningful for their engine and expose richer native metadata as extensions.

## Capability architecture

Capabilities represent **implemented NuBloxSQL adapter behaviour**, not a marketing list of what the underlying server could theoretically do.

Examples include prepared statements, server-side cursors, savepoints, schemas, catalogs, transactional DDL, query cancellation, multiple active results, native JSON/document behaviour and CDC/replication support.

Capabilities may vary by adapter version, server version or connection/runtime conditions.

## Result and type architecture

The portable result model distinguishes rows from command outcomes and retains extension space for native metadata.

Type conversion must prioritise fidelity. When JavaScript cannot preserve a database value safely, an adapter should retain a lossless representation rather than silently coerce it.

## Consumer boundary

NuBlox SQL Workbench is a major intended consumer but is not part of this repository's runtime boundary.

Workbench responsibilities include:

- editor and execution UX;
- connection-profile management UX;
- object explorer presentation;
- schema-design workflows;
- administration workflows;
- migration and comparison tools;
- user-facing diagnostics.

NuBloxSQL responsibilities include:

- actual database connectivity;
- protocol/runtime semantics;
- execution and transactions;
- metadata retrieval;
- type handling;
- cancellation and resource safety;
- capability discovery;
- database-native extensions.

## Non-goals

NuBloxSQL must not become:

- a universal ORM;
- a SQL UI product;
- a lowest-common-denominator facade;
- a universal SQL parser required for basic connectivity;
- a place where native features are renamed into misleading generic concepts;
- a transport implementation duplicated inside consumer applications.

## Compatibility and evolution

Stable contracts evolve conservatively. New adapters are expected to pressure-test the platform model.

The platform should grow by evidence:

1. implement native behaviour correctly;
2. identify genuinely portable concepts;
3. promote those concepts into SQL Core only when proven;
4. keep native escape hatches first class;
5. maintain cross-dialect contract tests and per-dialect live tests.

See [Design Intent](design-intent.md) for the product-level rationale and `../../NUBLOX-SQL-ROADMAP.md` for the active delivery sequence.
