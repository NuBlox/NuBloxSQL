# NuBloxSQL User Guides

These guides document the released NuBloxSQL 1.1.x public surface. They are written for application developers using the single `nubloxsql` package.

Use these guides together with the [support matrix](../SUPPORT.md), [public API summary](../API.md), and the current [release note](../releases/1.1.0.md).

## Start here

1. [Getting started](01-getting-started.md) — install NuBloxSQL, create a client, run a query, and close resources correctly.
2. [Connections and pooling](02-connections-and-pooling.md) — configuration objects, connection URLs, pools, lifecycle, TLS and acquisition settings.
3. [SQL, parameters and typed values](03-sql-parameters-and-types.md) — tagged SQL, identifier quoting, value binding, named prepared parameters and portable type intent.
4. [Prepared statements and result APIs](04-prepared-and-results.md) — `query`, `all`, `one`, `execute`, reusable prepared statements and result metadata.
5. [Transactions and savepoints](05-transactions.md) — automatic commit/rollback, nested transactions, savepoints, isolation and retry policies.
6. [Streaming and operation control](06-streaming-and-operation-control.md) — async iteration, early close, timeouts, deadlines, abort signals and result budgets.
7. [Metadata and introspection](07-metadata-and-introspection.md) — catalog APIs, deep snapshots and portable metadata vocabulary v1.
8. [Errors, retries and recovery](08-errors-retries-and-recovery.md) — portable error categories, native diagnostics, retryability and recovery rules.
9. [Observability and type codecs](09-observability-and-type-codecs.md) — telemetry callbacks, slow-operation reporting, custom encoders and decoders.
10. [Dialect guide](10-dialects.md) — PostgreSQL, MySQL, SQLite and SQL Server configuration and native-depth features.
11. [Capabilities and SQL portability](11-capabilities-and-portability.md) — capability discovery, compatibility analysis, rewrite planning and the current SQL AST/transpilation scope.
12. [TypeScript guide](12-typescript.md) — dialect discrimination, typed clients, portable metadata and result typing.
13. [Production operation and troubleshooting](13-production-and-troubleshooting.md) — production configuration, cleanup, resource limits, diagnosis and common failure patterns.
14. [DDL compiler](14-ddl-compiler.md) — structured table/index/view/schema/sequence ASTs, constraints, capability-gated schema portability and the precise `ddl-v1` boundary.
15. [Canonical type semantics](15-canonical-type-semantics.md) — cross-dialect type families, metadata annotation, mapping decisions and explicit lossiness.
16. [Canonical schema snapshots](16-canonical-schema-snapshots.md) — deterministic schema normalization, logical object keys and semantic/source fingerprints.

## Documentation rules

The guides describe only released APIs and supported behaviour. Engine-specific APIs are called out explicitly and must not be assumed portable. Where NuBloxSQL exposes both a portable view and native engine detail, the native detail remains available so database-specific semantics are not hidden.

Historical development notes are preserved under `docs/archive/` and are not part of the current user contract.
