# PostgreSQL Tier-1 Capability Map — exhaustive-v1

## Scope

PostgreSQL is the first Tier-1 dialect promoted from `foundation` to `exhaustive-v1` coverage in the NuBloxSQL SQL Capability Model.

The map uses PostgreSQL 18 as the reference surface while retaining `since`, syntax, semantic-equivalence and evidence metadata so future runtime/server-version qualification can resolve differences across PostgreSQL 15, 16, 17 and 18.

`exhaustive-v1` means the model covers the major SQL/database semantic domains required by the NuBloxSQL capability taxonomy. It does not mean every built-in function, GUC, catalog column or extension supplied by the PostgreSQL ecosystem has been individually enumerated.

## Covered semantic domains

The PostgreSQL descriptor now maps all 18 NuBloxSQL capability categories:

- statements and transaction-control commands
- joins, subqueries, CTEs, recursive SEARCH/CYCLE, set operations, grouping and windows
- tables, views, materialized views, indexes, sequences, types, policies, statistics and foreign-data objects
- scalar/conditional expressions, arrays, JSON/JSONB, SQL/JSON, ranges, regex, date/time and XML
- keys, checks, exclusion constraints, deferrability, generated columns, identity and PostgreSQL 18 temporal constraints
- declarative partitioning, inheritance, tablespaces, access methods, index methods, TOAST and storage controls
- roles, grants, ownership, RLS and security-definer/invoker semantics
- MVCC/isolation, savepoints, two-phase commit and locking
- functions, procedures, PL/pgSQL, dynamic SQL, triggers and event triggers
- EXPLAIN, ANALYZE, VACUUM, REINDEX, monitoring and session configuration
- COPY, foreign data wrappers and logical replication
- extensions and user-extensible types/operators/aggregates/access methods
- PostgreSQL native type families
- scalar, aggregate, ordered-set, hypothetical-set, window and set-returning functions
- native/user-defined operators and operator classes/families
- keyword classification
- PostgreSQL-specific SQL syntax
- operational/runtime limits exposed through server configuration

## Evidence policy

The descriptor has an `evidenceRegister` of primary PostgreSQL documentation URLs. Individual mapped capability leaves carry one or more `references` where practical.

The primary evidence set includes PostgreSQL 18 documentation for:

- `SELECT`, `INSERT`, `UPDATE`, `DELETE` and `MERGE`
- `CREATE TABLE` and `CREATE INDEX`
- views and materialized views
- generated columns and constraints
- data types and functions/operators
- functions, procedures and PL/pgSQL
- transaction isolation and locking
- administrative functions
- `EXPLAIN`, `VACUUM`, `ANALYZE` and `REINDEX`
- `COPY`
- row-level security and roles
- foreign data wrappers and logical replication
- extensions, monitoring statistics and runtime configuration
- PostgreSQL 18 release notes for version-specific additions

## Important semantic decisions

### READ UNCOMMITTED

PostgreSQL accepts the isolation level name but internally treats it as `READ COMMITTED`. The model therefore marks it `equivalent`, not `native` in the semantic sense.

### Nested transactions

PostgreSQL does not expose independently nested top-level transactions. NuBloxSQL marks nested transaction semantics `emulated` through savepoints.

### Sharding and columnstore

Core PostgreSQL is intentionally marked unsupported for transparent native sharding and native columnstore storage. Extensions and external systems may provide these capabilities, but extension-provided functionality is not silently attributed to core PostgreSQL.

### Generated columns

PostgreSQL 18 adds virtual generated columns. `generatedVirtual` is therefore marked native with `since: "18"`; stored generated columns remain native independently.

### PostgreSQL 18 temporal constraints

`WITHOUT OVERLAPS` and `PERIOD` foreign-key semantics are explicitly versioned at PostgreSQL 18 in the map.

### Core query hints

PostgreSQL core has planner settings and rich `EXPLAIN`, but no general SQL optimizer-hint syntax. This is recorded as unsupported rather than conflated with planner configuration.

## Next qualification work

The later M6 runtime-qualification milestone will combine this static descriptor with live server evidence so a connected PostgreSQL 15/16/17/18 server can return a version-resolved capability view rather than only the PostgreSQL 18 reference model.
