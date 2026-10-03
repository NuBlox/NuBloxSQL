# Public API

NuBloxSQL exposes one package entry point:

```js
const sql = require('nubloxsql');
```

For task-oriented usage see the [NuBloxSQL User Guides](guides/README.md) and [Cookbook](cookbook/README.md).

## Primary entry points

- `createClient()` — unified client for a configured dialect.
- `createConnection()` — native dialect connection.
- `createPool()` — native pool where supported.
- `sql` — tagged SQL, identifiers, named parameters and portable typed values.
- `introspect()` — one-shot metadata/schema introspection.
- `capabilityReport()` — static platform capability report.
- `transactionPolicy()` — portable transaction-policy description.
- `capabilityModel` — Tier-1 compatibility, runtime qualification, rewrite and compiler/transpilation APIs.
- `capabilityOntology` — atomic capability definitions, engine observations and NuBlox implementation coverage.

## Capability ontology

`capabilityOntology` (`SQL_CAPABILITY_ONTOLOGY_SCHEMA_VERSION === 1`) separates engine support, conditional availability, lifecycle maturity and NuBlox implementation coverage.

```js
const definition = sql.capabilityOntology.definition('schema.tableAlter.renameColumn');
const engine = sql.capabilityOntology.observation('sqlite', 'schema.tableAlter.renameColumn');
const nublox = sql.capabilityOntology.implementation('schema.tableAlter.renameColumn');
const resolved = sql.capabilityOntology.resolve('sqlite', 'schema.tableAlter.renameColumn', {
  version: '3.49.1'
});
```

`profile(dialect)` returns an engine inventory. `inventory({ dialect, family, kind })` supports filtered tooling. `validate()` verifies ontology integrity. Legacy `capabilityModel.status()`, `compare()`, compatibility and rewrite APIs remain supported.

## SQL AST and transpilation

`capabilityModel.parseSql()`, `analyzeAst()`, `compileAst()` and `transpileSql()` expose the released Tier-1 compiler surface for PostgreSQL, MySQL and SQLite.

| Scope | Released compiler surface |
| --- | --- |
| `select-foundation-v1` | SELECT, joins, grouping, ordering and pagination |
| `select-query-v2` | CTEs, recursive CTE declarations, subqueries and derived tables |
| `select-query-v3` | UNION/INTERSECT/EXCEPT families and compound-query composition |
| `select-query-v4` | CASE, CAST, richer predicates, windows and window frames |
| `dml-v1` | INSERT, INSERT-SELECT, UPDATE, DELETE and capability-gated RETURNING |
| `dml-v2` | explicit UPSERT/conflict semantics and PostgreSQL MERGE subset |
| `ddl-v1` | structured CREATE TABLE/INDEX/VIEW/SCHEMA/SEQUENCE and DROP TABLE/VIEW |
| `ddl-v2` | atomic ALTER TABLE add/drop/rename-column and rename-table lifecycle operations |
| `ddl-v3` | ALTER COLUMN type/default/nullability and named constraint lifecycle |
| `ddl-v4` | schema-object drop lifecycle plus statement-specific `IF EXISTS` / `IF NOT EXISTS` modifiers |

A successful compilation certifies the modeled syntax/capability plan for that scope. It does **not** claim identical vendor coercion, collation, precision, conflict, trigger, storage or physical-design semantics where engines differ.

### Query composition

Set-operation parsing preserves source-dialect precedence in the AST. Unsupported target capabilities fail closed rather than changing semantics. Window nodes model `OVER`, partition/order specifications, frames, `EXCLUDE` and named windows. PostgreSQL `expression::type` is normalized to the structured cast AST.

### DML (`dml-v1` and `dml-v2`)

`dml-v1` uses first-class INSERT/UPDATE/DELETE ASTs and reuses the query/expression compiler. `RETURNING` remains capability-driven: PostgreSQL is native; MySQL is rejected; SQLite requires runtime qualification when its capability state is runtime-dependent.

`dml-v2` represents PostgreSQL/SQLite `ON CONFLICT`, MySQL `ON DUPLICATE KEY UPDATE`, and PostgreSQL `MERGE` as distinct semantic families. NuBloxSQL does not automatically translate materially different conflict semantics.

### DDL foundation (`ddl-v1`)

`ddl-v1` models structured `CREATE TABLE`, `CREATE INDEX`, `CREATE VIEW`, `CREATE SCHEMA`, `CREATE SEQUENCE`, `DROP TABLE` and `DROP VIEW`. Table definitions include structured types, `NOT NULL`, scalar defaults, keys, checks and basic foreign-key references. Partial-index targets remain capability-gated.

### ALTER TABLE lifecycle (`ddl-v2`)

`ddl-v2` covers add/drop column, rename column and rename table. Each operation has its own `schema.tableAlter.*` capability. SQLite `RENAME COLUMN` is version-gated from 3.25.0 and `DROP COLUMN` from 3.35.0. `ADD COLUMN` deliberately remains a plain name + type subset.

### Column and constraint lifecycle (`ddl-v3`)

`ddl-v3` adds structured semantic actions for:

- `ALTER COLUMN ... TYPE ...`;
- `SET DEFAULT` / `DROP DEFAULT`;
- `SET NOT NULL` / `DROP NOT NULL`;
- named `ADD CONSTRAINT` for primary-key, unique, check and basic foreign-key definitions;
- `DROP CONSTRAINT`.

PostgreSQL/MySQL default lifecycle is the qualified common native subset. PostgreSQL type/nullability changes are not automatically lowered to MySQL `MODIFY COLUMN`, because MySQL requires a complete resulting column definition. SQLite ddl-v3 operations fail closed rather than hiding a table-rebuild migration.

### Schema-object lifecycle (`ddl-v4`)

`ddl-v4` adds:

- `DROP INDEX`;
- `DROP SCHEMA`;
- PostgreSQL `DROP SEQUENCE`;
- supported `DROP ... IF EXISTS` forms;
- supported `CREATE ... IF NOT EXISTS` forms.

Existence modifiers are modeled as **statement-specific atomic capabilities**, not one global boolean. For example, PostgreSQL and SQLite support `CREATE INDEX IF NOT EXISTS`, while the released MySQL profile rejects that form.

```js
const lifecycle = sql.capabilityModel.transpileSql(
  'postgresql',
  'sqlite',
  'DROP INDEX IF EXISTS ledger_amount_idx'
);

console.log(lifecycle.scope); // ddl-v4
```

Index identity is also explicit. PostgreSQL and SQLite drop an index by index identity; MySQL uses `DROP INDEX name ON table`. NuBloxSQL therefore does not infer the MySQL table or silently translate a MySQL table-scoped drop to a PostgreSQL/SQLite object identity.

Likewise, PostgreSQL schemas are namespaces while MySQL treats `SCHEMA` as a database synonym. Same-dialect `DROP SCHEMA` is supported where native, but automatic PostgreSQL↔MySQL schema/database translation fails closed.

`ddl-v4` currently excludes `CASCADE`/`RESTRICT`, multi-object drops, concurrent index lifecycle, vendor locking/algorithm clauses and metadata-inferred object identity.

## Runtime qualification

Use a live qualification report where either source or target availability depends on version/runtime evidence:

```js
const runtime = await sql.capabilityModel.qualifyClient(db);

const result = sql.capabilityModel.transpileSql(
  'postgresql',
  'sqlite',
  'ALTER TABLE ledger DROP COLUMN obsolete',
  { targetQualification: runtime }
);
```

Unknown states remain unresolved; NuBloxSQL does not convert them into optimistic support claims.

## Query diagnostics

Tier-1 clients expose `client.diagnose(statement, options)` for PostgreSQL, MySQL and SQLite. The portable report normalizes only defensible common metrics and keeps the complete engine-native report under `native`. SQL Server is not yet part of this qualified portable diagnostics surface.

## Metadata

Metadata snapshots retain native-rich evidence and expose `snapshot.portable`, an immutable portable metadata vocabulary v1. The portable projection normalizes common schema concepts without discarding native metadata.

## Exact release contract

The exact exported JavaScript surface and required package files are machine-defined in `docs/releases/public-api-v1.json`.

The TypeScript entry point is `types/root.d.ts`; query/compiler declarations are in `types/public.d.ts`, DML statements in `types/dml.d.ts`, DDL statements in `types/ddl.d.ts`, portable metadata in `types/portable-metadata.d.ts`, query diagnostics in `types/diagnostics.d.ts`, and ontology declarations in `types/capability-ontology.d.ts`.

Release qualification installs the packed npm artifact into clean JavaScript and strict TypeScript consumers. Dedicated `dml-v2`, `ddl-v1`, `ddl-v2`, `ddl-v3` and `ddl-v4` gates verify their released semantic surfaces.
