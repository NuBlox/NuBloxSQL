# SQLite Tier-1 Capability Map — exhaustive-v1

## Scope

SQLite is the third Tier-1 dialect promoted to `exhaustive-v1`. Unlike PostgreSQL and MySQL, its effective feature surface depends on three independent layers:

1. the SQLite library version,
2. SQLite compile options/extensions,
3. capabilities exposed by the host binding (`node:sqlite` in NuBloxSQL).

The descriptor therefore deliberately uses `runtime-dependent` for features that cannot be truthfully guaranteed from the NuBloxSQL package version alone.

## Major coverage

The map spans all 18 NuBloxSQL categories, including:

- DML/DDL, ATTACH/DETACH, transactions, PRAGMAs and maintenance commands
- ordinary/recursive CTEs, materialization hints, set operations, windows and modern RIGHT/FULL JOIN support
- tables/views/triggers, WITHOUT ROWID, STRICT, virtual tables, partial indexes and expression indexes
- dynamic typing, affinity, JSON/JSONB, date/time conventions, collations and application-defined REGEXP behavior
- keys/checks/foreign keys, deferred FKs, generated columns and ROWID/AUTOINCREMENT identity semantics
- rollback journals, WAL, locking, synchronous policy, cache/mmap/page/vacuum controls
- the absence of server-style users/roles/grants, plus host-level authorizer/defensive/extension-loading controls
- DEFERRED/IMMEDIATE/EXCLUSIVE transactions, savepoints, one-writer semantics and WAL concurrency
- triggers and application-defined scalar/aggregate/window functions instead of stored procedures
- EXPLAIN QUERY PLAN, ANALYZE, VACUUM, PRAGMA optimize, integrity checks and WAL checkpointing
- ATTACH, backup/serialization and capability-detected session changesets
- virtual tables, FTS5, RTree, JSON and loadable extensions
- storage classes, affinities and STRICT table types
- built-in/application-defined functions and SQLite-specific operators
- RETURNING, UPSERT/conflict algorithms, INDEXED BY, WITHOUT ROWID and STRICT syntax
- SQLite implementation limits and NuBloxSQL resource-governance integration

## Important semantic distinctions

### Runtime-dependent does not mean unsupported

Capabilities such as JSONB, FTS5, session changesets, host authorizers and mutable runtime limits may be available in one supported Node/SQLite runtime and absent in another. The static model therefore returns `supported: null` until later runtime qualification resolves them.

### Foreign keys

SQLite foreign-key syntax exists, but enforcement depends on build support and per-connection configuration. NuBloxSQL enables foreign keys by default in its SQLite connection unless explicitly disabled, but the semantic capability remains runtime-aware because the underlying SQLite library may be built without foreign-key support.

### Typing

SQLite's native model is dynamic typing with five storage classes and column affinity. STRICT tables are modelled separately rather than pretending SQLite has the same rigid type system as PostgreSQL or MySQL.

### Identity

`INTEGER PRIMARY KEY` aliases the ROWID and is the canonical SQLite identity mechanism. `AUTOINCREMENT` changes ROWID reuse/allocation semantics; it is not treated as SQL-standard identity.

### Programmability

SQLite has triggers but no stored procedure language. User-defined scalar, aggregate and window functions are host/application integration points and are represented as semantic equivalents rather than stored SQL functions.

### Security

SQLite is embedded and has no server account/role/grant model. Those concepts are `not-applicable`, not merely unsupported. Host authorizer, defensive mode, query-only mode and extension-loading policy are represented separately.

### Concurrency

SQLite's concurrency model is database/file-lock based and permits a single writer. WAL improves reader/writer concurrency but does not turn SQLite into a multi-writer server database.

## Primary evidence

The evidence register points to SQLite's official documentation for the SQL language, CTEs, windows, RETURNING, UPSERT/conflict handling, dynamic typing, STRICT and generated columns, WITHOUT ROWID, indexes, JSON, foreign keys, transactions/locking/WAL, PRAGMAs, VACUUM/ANALYZE/EXPLAIN, limits, ATTACH, virtual tables, FTS5, RTree, loadable extensions, sessions and compile options.

M6 will combine this descriptor with the existing NuBloxSQL SQLite runtime probes to produce a resolved capability view for the actual bundled SQLite/Node runtime.
