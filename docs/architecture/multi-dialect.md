# Multi-Dialect Architecture

## Decision

NuBloxSQL is an independent multi-package SQL connectivity and runtime platform for Node.js. Portable contracts live in `@nublox/sql-core`; database-specific protocol, authentication, storage, locking, type and lifecycle behaviour stays inside each adapter.

## Current package architecture

```text
NuBloxSQL workspace
├── @nublox/sql-core@1.0.0        stable portable contract family 1.0
├── @nublox/mysql@1.0.0           stable native MySQL adapter
├── @nublox/postgresql@1.0.0      stable native PostgreSQL adapter
└── @nublox/sqlite@0.1.0          post-v1 SQLite development adapter
```

SQL Server and Oracle are planned future adapters.

## Boundary model

The architecture separates three concerns:

1. **Portable contracts** — concepts that can be represented without changing database semantics.
2. **Dialect services** — identifier quoting, placeholders, naming and capability metadata.
3. **Adapter runtime** — connection lifecycle, protocol or embedded API, authentication, execution, pooling, transactions, type decoding and vendor-native behaviour.

```text
                    @nublox/sql-core
                           │
          ┌────────────────┼────────────────┐
          │                │                │
          ▼                ▼                ▼
  @nublox/mysql   @nublox/postgresql   @nublox/sqlite
          │                │                │
   MySQL protocol   PostgreSQL protocol   node:sqlite
```

## Architecture rules

1. Keep the repository root as workspace/release orchestration, not a generic runtime driver.
2. Keep each adapter independently versioned, testable and publishable.
3. Promote concepts into SQL Core only when multiple real adapters prove portable semantics.
4. Keep vendor-specific extensions first class rather than flattening them into misleading common APIs.
5. Make unsupported behaviour explicit through capability metadata.
6. Never silently emulate semantics when the emulation would materially differ from the native database.
7. Keep protocol/storage implementations isolated by adapter.
8. Preserve deterministic resource limits, error classification and lifecycle safety.
9. Keep NuBloxSQL architecture independent of consuming applications and other NuBlox projects.

## SQL Core contract

SQL Core contract family `1.0` is stable. It covers the proven portable surface, including:

- dialect identity and capabilities;
- identifier quoting and placeholders;
- object-name vocabulary;
- structural cancellation signals and relative timeout policy;
- bounded result policy;
- positional execution parameters;
- row/command result vocabulary;
- portable field metadata with extension space;
- transaction policy;
- error categories and native diagnostic preservation.

Breaking changes to the frozen contract require a new major version. New adapter-specific capabilities do not require SQL Core changes unless they become genuinely portable.

See `docs/v1/SQL-CORE-V1-CONTRACT.md`.

## Adapter boundaries

### MySQL

MySQL-specific implementation includes classic protocol framing, authentication plugins, prepared-statement binary protocol, session reset, MySQL transaction/session state, streaming and MySQL-native diagnostics.

### PostgreSQL

PostgreSQL-specific implementation includes frontend/backend protocol framing, startup/TLS/authentication, SCRAM-SHA-256, extended-query protocol, prepared statements, portals, BackendKeyData/CancelRequest, PostgreSQL transaction state and OID-based type decoding.

### SQLite

SQLite is an embedded adapter rather than a client/server driver. SQLite-specific implementation includes `node:sqlite`, synchronous database lifecycle, SQLite transaction modes, busy policy, attached-database semantics, PRAGMA-driven metadata and file/storage locking behaviour.

SQLite must not claim server-side capabilities merely to resemble the network adapters.

## Metadata semantics

Catalogs, databases and schemas are not treated as interchangeable words. The portable name shape allows qualifiers, but each adapter decides which qualifiers are meaningful for its database family.

```ts
interface SqlObjectName {
  catalog?: string;
  schema?: string;
  name: string;
}
```

## Capability semantics

Capability flags describe implemented adapter behaviour, not the complete feature set of the underlying database engine. A server feature is not a NuBloxSQL capability until the adapter exposes it with defined semantics and tests.

## Compatibility strategy

External drivers may be used for behavioural comparison or migration testing, but NuBloxSQL's supported runtime surface remains NuBlox-authored and adapter-owned. Decisions to introduce external implementation dependencies require an explicit product, security and licensing decision.

## Release boundaries

The stable NuBloxSQL v1.0.0 release consists of SQL Core, MySQL and PostgreSQL at `1.0.0`. SQLite `0.1.0` is post-v1 development and does not alter the stable v1 support claim.

Current development sequencing is maintained in `NUBLOX-SQL-ROADMAP.md`.
