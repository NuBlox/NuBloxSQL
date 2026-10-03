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
| `ddl-v3` | ALTER COLUMN type/default/nullability and named constraint lifecycle with explicit dialect boundaries |

A successful compilation certifies the modeled syntax/capability plan for that scope. It does **not** claim identical vendor coercion, collation, precision, conflict, trigger, storage or physical-design semantics where engines differ.

### Query composition

Set-operation parsing preserves source-dialect precedence in the AST. Unsupported target capabilities fail closed rather than changing semantics. Window nodes model `OVER`, partition/order specifications, frames, `EXCLUDE` and named windows. PostgreSQL `expression::type` is normalized to the structured cast AST.

### DML (`dml-v1` and `dml-v2`)

`dml-v1` uses first-class INSERT/UPDATE/DELETE ASTs and reuses the query/expression compiler. `RETURNING` remains capability-driven: PostgreSQL is native; MySQL is rejected; SQLite requires runtime qualification when its capability state is runtime-dependent.

`dml-v2` represents PostgreSQL/SQLite `ON CONFLICT`, MySQL `ON DUPLICATE KEY UPDATE`, and PostgreSQL `MERGE` as distinct semantic families. NuBloxSQL does not automatically translate materially different conflict semantics.

### DDL foundation (`ddl-v1`)

`ddl-v1` models:

- `CreateTableStatement` and structured column/type definitions;
- column/table `PRIMARY KEY`, `UNIQUE`, `CHECK` and foreign-key references;
- `NOT NULL` and scalar `DEFAULT` expressions;
- unique/basic/partial index creation with capability gating;
- `CREATE VIEW` using the released query compiler;
- basic `CREATE SCHEMA` and `CREATE SEQUENCE`;
- `DROP TABLE` and `DROP VIEW`.

```js
const ddl = sql.capabilityModel.transpileSql(
  'postgresql',
  'mysql',
  `CREATE TABLE ledger (
     id INTEGER PRIMARY KEY,
     name VARCHAR(100) NOT NULL UNIQUE,
     amount DECIMAL(12,2) DEFAULT 0 CHECK (amount >= 0)
   )`
);
```

MySQL partial-index targets are rejected rather than having the predicate dropped. SQLite runtime-dependent schema capabilities require live/version qualification. `CREATE SCHEMA` is not silently rewritten to MySQL `CREATE DATABASE` because the current model records an equivalent—not proven identical—construct.

### DDL lifecycle (`ddl-v2`)

`ddl-v2` covers:

- `ALTER TABLE ... ADD [COLUMN] name type`;
- `ALTER TABLE ... DROP [COLUMN] name`;
- `ALTER TABLE ... RENAME COLUMN old TO new`;
- `ALTER TABLE ... RENAME TO new_table`.

Each action has its own atomic capability ID under `schema.tableAlter.*`. SQLite `RENAME COLUMN` is version-gated from 3.25.0 and `DROP COLUMN` from 3.35.0. Source SQLite syntax is also version-qualified when transpiling away from SQLite.

`ADD COLUMN` remains intentionally limited to a plain name + type because ALTER-time defaults, constraints and existing-row effects differ materially across engines.

### Column and constraint lifecycle (`ddl-v3`)

`ddl-v3` adds structured semantic actions for:

- `ALTER COLUMN ... TYPE ...`;
- `ALTER COLUMN ... SET DEFAULT ...`;
- `ALTER COLUMN ... DROP DEFAULT`;
- `ALTER COLUMN ... SET NOT NULL`;
- `ALTER COLUMN ... DROP NOT NULL`;
- `ADD CONSTRAINT name` for `PRIMARY KEY`, `UNIQUE`, `CHECK` and basic `FOREIGN KEY` definitions;
- `DROP CONSTRAINT name`.

```js
const changed = sql.capabilityModel.transpileSql(
  'postgresql',
  'mysql',
  'ALTER TABLE ledger ALTER COLUMN amount SET DEFAULT 0'
);

console.log(changed.scope); // ddl-v3
```

`SET DEFAULT` and `DROP DEFAULT` are modeled as native PostgreSQL/MySQL operations. Other ddl-v3 operations are deliberately stricter:

- PostgreSQL `ALTER COLUMN ... TYPE` and nullability changes are **not** automatically lowered to MySQL `MODIFY COLUMN`, because MySQL requires the complete target column definition and existing metadata can affect semantics;
- PostgreSQL generic constraint lifecycle is **not** treated as equivalent to MySQL's constraint-kind-specific drop/alter syntax;
- SQLite rejects ddl-v3 operations because safe support generally requires a table-rebuild strategy rather than a direct ALTER statement.

These cases fail closed with an explicit semantic-transformation or unsupported-capability error instead of emitting plausible but unsafe SQL.

Named constraints in `ddl-v3` currently cover the portable structural subset only. Foreign-key actions, match modes, deferrability and vendor-specific constraint modifiers remain outside this scope.

The current DDL compiler still does not claim:

- generated/identity columns;
- `IF EXISTS` / `IF NOT EXISTS` modifiers;
- `CREATE TABLE AS`;
- multi-action ALTER TABLE;
- automatic MySQL `MODIFY COLUMN` lowering;
- automatic SQLite table-rebuild migrations;
- `DROP INDEX`, `DROP SCHEMA` or `DROP SEQUENCE` compiler nodes;
- expression indexes, index methods, included columns or vendor index modifiers;
- sequence options;
- table engines, tablespaces, partitioning, distribution, clustering or other physical-storage clauses.

SQL type names and modifiers are structured AST data. Cross-dialect DDL certification does not imply identical physical storage, affinity, collation, coercion, precision or overflow behavior.

## Runtime qualification

Use a live qualification report where either the source or target capability is version/runtime dependent:

```js
const runtime = await sql.capabilityModel.qualifyClient(db);

const result = sql.capabilityModel.transpileSql(
  'postgresql',
  'sqlite',
  'ALTER TABLE ledger DROP COLUMN obsolete',
  { targetQualification: runtime }
);
```

Unknown or unresolved states remain unresolved; NuBloxSQL does not convert them into optimistic support claims.

## Query diagnostics

Tier-1 clients expose `client.diagnose(statement, options)` for PostgreSQL, MySQL and SQLite. The portable report normalizes only defensible common metrics and keeps the complete engine-native report under `native`. SQL Server is not yet part of this qualified portable diagnostics surface.

## Metadata

Metadata snapshots retain native-rich evidence and expose `snapshot.portable`, an immutable portable metadata vocabulary v1. The portable projection normalizes common schema concepts without discarding native metadata.

## Exact release contract

The exact exported JavaScript surface and required package files are machine-defined in `docs/releases/public-api-v1.json`.

The TypeScript entry point is `types/root.d.ts`; query/compiler declarations are in `types/public.d.ts`, DML statements in `types/dml.d.ts`, DDL statements in `types/ddl.d.ts`, portable metadata in `types/portable-metadata.d.ts`, query diagnostics in `types/diagnostics.d.ts`, and ontology declarations in `types/capability-ontology.d.ts`.

Release qualification installs the packed npm artifact into clean JavaScript and strict TypeScript consumers. Dedicated `dml-v2`, `ddl-v1`, `ddl-v2` and `ddl-v3` gates verify their released semantic surfaces.
