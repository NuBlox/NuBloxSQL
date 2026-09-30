# SQLite advanced schema introspection

NuBloxSQL exposes SQLite through the same public metadata/catalog API used by the other dialects, while retaining SQLite-specific schema evidence where it materially improves correctness.

## Table semantics

`metadata.tables()` and deep `introspect()` snapshots enrich SQLite table/view entries with:

- `definition`: raw `sqlite_schema.sql` DDL when SQLite stores one;
- `strict`: whether the object is a STRICT table;
- `withoutRowid`: whether the table uses `WITHOUT ROWID`;
- `columnCount`: SQLite's reported column count.

The raw schema row and `PRAGMA table_list` evidence remain available in `native`.

## Generated columns

`metadata.columns(table)` continues to use `PRAGMA table_xinfo`, and additionally exposes:

- `generatedKind`: `virtual`, `stored`, or `null`;
- `generationExpression`: the expression recovered from the table definition when available.

`hidden` remains the raw SQLite table-xinfo classification so callers that need SQLite-native semantics can still inspect the source evidence.

## Indexes

`metadata.indexes(table)` uses `PRAGMA index_list`, `PRAGMA index_xinfo`, and the stored `CREATE INDEX` statement.

SQLite index entries expose:

- `partial`;
- `predicate` for partial indexes;
- `definition`;
- `keyParts`, preserving ordinal, column/expression, collation and descending order;
- `expressions`, aligned to the index key positions.

Expression indexes intentionally keep the portable `columns` entry as `null` for an expression key. The expression itself is surfaced in `keyParts[].expression` and `expressions[]`; NuBloxSQL does not pretend an expression is a physical column.

## Foreign keys

Composite SQLite foreign keys remain grouped as one portable foreign-key object. The advanced surface adds:

- SQLite foreign-key `id`;
- ordered `sequence` values;
- ordered local and referenced column arrays;
- update/delete/match actions.

## Constraints

SQLite does not provide one complete catalog view for table constraints, so NuBloxSQL composes evidence from:

- `table_xinfo` for primary keys;
- `index_list` / `index_xinfo` for unique constraints/index-backed uniqueness;
- `foreign_key_list` for foreign keys;
- `sqlite_schema.sql` for CHECK constraints.

CHECK constraints expose their expression and stored definition. Explicit `CONSTRAINT <name> CHECK (...)` names are preserved; unnamed checks receive a deterministic catalog name (`check_<table>_<ordinal>`).

## Portability policy

The portable metadata shape remains authoritative. SQLite-specific enrichment is additive and never changes another dialect's semantics. Native evidence is retained rather than discarded so tooling can make engine-specific decisions without bypassing NuBloxSQL.
