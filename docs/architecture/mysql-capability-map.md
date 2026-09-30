# MySQL Tier-1 Capability Map — exhaustive-v1

## Scope

MySQL is the second Tier-1 dialect promoted to `exhaustive-v1` coverage. MySQL 9.7 is the reference surface, with explicit version metadata where an important feature entered the MySQL 8.x line.

The map describes core MySQL semantics rather than assuming PostgreSQL equivalence. Storage-engine-dependent behavior and server configuration requirements are recorded as restrictions where they materially affect support.

## Major coverage

The descriptor covers all 18 NuBloxSQL capability categories, including:

- DML/DDL/DCL, `REPLACE`, transaction control and XA transactions
- joins, LATERAL, CTEs, set operations, windows, locking reads and MySQL-specific query forms
- tables/views/indexes, functional/descending/invisible/multi-valued/full-text/spatial indexes, routines, triggers and events
- JSON/JSON_TABLE, regex, date/time, collations and MySQL conditional expressions
- constraints, generated virtual/stored columns and AUTO_INCREMENT identity semantics
- storage engines, InnoDB/NDB-aware partitioning, tablespaces, row formats and compression
- accounts, roles, dynamic privileges, grants and SQL SECURITY
- InnoDB MVCC/isolation, savepoints, row/table locks, NOWAIT/SKIP LOCKED and XA
- stored procedures/functions, compound statements, handlers, dynamic SQL, triggers and Event Scheduler
- EXPLAIN ANALYZE, ANALYZE TABLE histograms, OPTIMIZE TABLE, Performance Schema, sys schema and optimizer/index hints
- LOAD DATA, SELECT INTO OUTFILE, replication and FEDERATED behavior
- plugin/component/storage-engine extension points
- MySQL native type families, JSON and spatial types
- scalar/aggregate/window/loadable functions and native operator families
- INFORMATION_SCHEMA keyword metadata
- MySQL-specific syntax and server-variable limits

## Important semantic distinctions

### Set operations

Current MySQL supports `UNION`, `INTERSECT` and `EXCEPT`, including `ALL`. The capability map therefore does not retain the older assumption that MySQL only has UNION.

### LATERAL

Lateral derived tables are native beginning with MySQL 8.0.14 and are versioned accordingly.

### Materialized views and sequences

Core MySQL has neither PostgreSQL-style materialized views nor general sequence objects; both remain unsupported.

### Generated columns

Virtual and stored generated columns are both native. Functional indexes are separately modelled because MySQL also supports functional key parts directly.

### Multi-valued indexes

MySQL supports multi-valued index key parts over JSON arrays with important restrictions. They are represented separately from general array types: MySQL still does not expose a general SQL array data type.

### Partitioning and foreign keys

Partitioning is native but storage-engine-dependent. For MySQL 9.7, partitioned InnoDB tables cannot participate in foreign-key relationships; this is represented as an explicit unsupported combination rather than hiding the restriction behind `partitioning: true`.

### Security

Accounts, roles and rich privileges are native, but core MySQL has no PostgreSQL-style row-level security policy object. `SQL SECURITY DEFINER/INVOKER` is modelled under programmability rather than mislabelled as RLS.

### Identity

`AUTO_INCREMENT` is modelled as a MySQL-native mechanism that is semantically equivalent to the canonical identity concept, not as SQL-standard identity syntax.

### RETURNING

The general PostgreSQL-style DML `RETURNING` capability is not attributed to core MySQL. Conflict handling is represented through MySQL's `ON DUPLICATE KEY UPDATE` and `REPLACE` semantics.

## Primary evidence

The evidence register points to current MySQL 9.7 reference material covering SELECT, CTEs, set operations, windows, generated columns, CREATE INDEX, JSON, partitioning, storage engines, roles/privileges, InnoDB transactions, stored programs, EXPLAIN/ANALYZE, Performance Schema, optimizer hints, LOAD DATA and replication.

Later M6 work will resolve the static reference model against a connected server version and runtime evidence.
