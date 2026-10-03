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

`capabilityOntology` (`SQL_CAPABILITY_ONTOLOGY_SCHEMA_VERSION === 1`) separates four different facts:

1. what a database engine supports;
2. under what version/edition/deployment/runtime conditions it is available;
3. lifecycle maturity such as stable, preview or deprecated;
4. what NuBloxSQL itself can parse, represent, validate, render, rewrite and qualify.

```js
const definition = sql.capabilityOntology.definition('statements.createTable');
const engine = sql.capabilityOntology.observation('postgresql', 'statements.createTable');
const nublox = sql.capabilityOntology.implementation('statements.createTable');
const resolved = sql.capabilityOntology.resolve('sqlite', 'schema.partialIndex', {
  version: '3.49.1'
});
```

`profile(dialect)` returns an engine inventory. `inventory({ dialect, family, kind })` supports filtered tooling. `validate()` verifies ontology integrity. Legacy `capabilityModel.status()`, `compare()`, compatibility and rewrite APIs remain supported.

## SQL AST and transpilation

`capabilityModel.parseSql()`, `analyzeAst()`, `compileAst()` and `transpileSql()` expose the released Tier-1 compiler surface for PostgreSQL, MySQL and SQLite.

Released compiler scopes are additive:

| Scope | Released compiler surface |
| --- | --- |
| `select-foundation-v1` | SELECT, joins, grouping, ordering and pagination |
| `select-query-v2` | CTEs, recursive CTE declarations, subqueries and derived tables |
| `select-query-v3` | UNION/INTERSECT/EXCEPT families and compound-query composition |
| `select-query-v4` | CASE, CAST, richer predicates, windows and window frames |
| `dml-v1` | INSERT, INSERT-SELECT, UPDATE, DELETE and capability-gated RETURNING |
| `dml-v2` | explicit UPSERT/conflict semantics and PostgreSQL MERGE subset |
| `ddl-v1` | structured CREATE TABLE/INDEX/VIEW/SCHEMA/SEQUENCE and DROP TABLE/VIEW |

A successful compilation means the modeled syntax/capability plan is certified for that scope. It does **not** claim identical vendor coercion, collation, precision, conflict, trigger, storage or physical-design semantics where engines differ.

### Query composition

Set-operation parsing preserves source-dialect precedence in the AST. PostgreSQL/MySQL `INTERSECT` precedence and SQLite left-to-right compound-query behavior are not treated as interchangeable text. Unsupported target capabilities such as SQLite `INTERSECT ALL` and `EXCEPT ALL` fail closed.

Window nodes model `OVER`, `PARTITION BY`, ordering, `ROWS`/`RANGE`/`GROUPS`, frame bounds, `EXCLUDE` and named windows. PostgreSQL `expression::type` is normalized to the structured cast AST and can render as `CAST(...)`.

### DML (`dml-v1` and `dml-v2`)

`dml-v1` uses first-class `InsertStatement`, `UpdateStatement`, `DeleteStatement` and `Assignment` AST nodes. Query expressions and `INSERT ... SELECT` reuse the query compiler.

```js
const mutation = sql.capabilityModel.transpileSql(
  'postgresql',
  'sqlite',
  `UPDATE ledger
   SET amount = CASE WHEN amount < $1 THEN $1 ELSE amount END
   WHERE id = $2`
);
```

`RETURNING` remains capability-driven. PostgreSQL is native; MySQL is rejected; SQLite requires runtime qualification when its capability state is runtime-dependent.

`dml-v2` represents PostgreSQL/SQLite `ON CONFLICT`, MySQL `ON DUPLICATE KEY UPDATE`, and PostgreSQL `MERGE` as explicit semantic families rather than interchangeable strings. NuBloxSQL does not automatically translate MySQL conflict semantics to PostgreSQL/SQLite conflict-target semantics.

The released PostgreSQL MERGE subset supports one matched UPDATE or DELETE and one not-matched INSERT ... VALUES action. MySQL and SQLite MERGE targets fail closed because no certified lowering is claimed.

### DDL (`ddl-v1`)

Wave 5 introduces structured schema ASTs:

- `CreateTableStatement` and `ColumnDefinition`;
- column/table `PRIMARY KEY`, `UNIQUE`, `CHECK` and foreign-key references;
- `NOT NULL` and scalar `DEFAULT` expressions;
- `CreateIndexStatement`, including unique indexes and capability-gated partial indexes;
- `CreateViewStatement`, whose query is parsed through the released query compiler;
- `CreateSchemaStatement`;
- `CreateSequenceStatement`;
- `DropTableStatement` and `DropViewStatement`.

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

console.log(ddl.scope); // ddl-v1
console.log(ddl.sql);
```

Capability planning remains authoritative. Examples:

- MySQL partial indexes are rejected rather than having the predicate dropped;
- SQLite runtime-dependent schema features require target qualification where the capability profile says so;
- `CREATE SCHEMA` is not silently rewritten to MySQL `CREATE DATABASE`; the current equivalent capability requires an explicit semantic rewrite policy;
- SQLite `CREATE SCHEMA` and sequence targets fail closed;
- PostgreSQL and MySQL `DROP VIEW` observations are explicitly modeled and documented rather than bypassing the planner.

The `ddl-v1` boundary deliberately excludes:

- named constraints;
- foreign-key `ON DELETE`/`ON UPDATE`, match and deferrability options;
- generated/identity columns;
- `IF EXISTS` / `IF NOT EXISTS` modifiers;
- `CREATE TABLE AS`;
- `ALTER TABLE`;
- `DROP INDEX`, `DROP SCHEMA` and `DROP SEQUENCE` compiler nodes;
- expression indexes, index methods, included columns and vendor index modifiers;
- sequence options;
- table engines, tablespaces, partitioning, distribution, clustering and other physical-storage clauses.

SQL type names and numeric modifiers are structured AST data. Cross-dialect DDL certification does not imply identical physical storage, affinity, collation, coercion, precision or overflow behavior.

## Runtime qualification

Use a live qualification report where a target capability is version/runtime dependent:

```js
const runtime = await sql.capabilityModel.qualifyClient(db);

const ddl = sql.capabilityModel.transpileSql(
  'postgresql',
  'sqlite',
  'CREATE INDEX positive_idx ON ledger (id) WHERE amount > 0',
  { targetQualification: runtime }
);
```

Unknown or unresolved capability states remain unresolved; NuBloxSQL does not convert them into optimistic support claims.

## Query diagnostics

Tier-1 clients expose `client.diagnose(statement, options)` for PostgreSQL, MySQL and SQLite. The versioned portable report normalizes only defensible common metrics and keeps the complete engine-native report under `native`.

`analyze: true` uses native execution-analysis semantics on PostgreSQL/MySQL. SQLite remains plan-only through the portable contract. SQL Server is not yet part of the qualified portable diagnostics surface.

## Metadata

Metadata snapshots retain native-rich evidence and expose `snapshot.portable`, an immutable portable metadata vocabulary v1. The portable projection normalizes common schema concepts without discarding native metadata.

## Public classes and contracts

The public package also includes `Client`, `ClientRowStream`, `MetadataCatalog`, `NuBloxSqlError`, `Observer`, `TypeRegistry`, dialect adapters and SQL Core.

Canonical runtime dialect names are `mysql`, `postgresql`, `sqlite` and `sqlserver`. The exhaustive compiler ontology currently uses PostgreSQL, MySQL and SQLite Tier-1 profiles; SQL Server remains a supported native runtime outside that exhaustive compiler surface.

## Exact release contract

The exact exported JavaScript surface and required package files are machine-defined in `docs/releases/public-api-v1.json`.

The TypeScript entry point is `types/root.d.ts`:

- query/compiler declarations: `types/public.d.ts`;
- DML statement declarations: `types/dml.d.ts`;
- DDL statement declarations: `types/ddl.d.ts`;
- portable metadata: `types/portable-metadata.d.ts`;
- query diagnostics: `types/diagnostics.d.ts`;
- capability ontology: `types/capability-ontology.d.ts`.

Release qualification installs the packed npm artifact into clean JavaScript and strict TypeScript consumers. Dedicated `dml-v2` and `ddl-v1` packed-package gates verify their released semantic surfaces.
