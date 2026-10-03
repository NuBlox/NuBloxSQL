# DDL compiler guide

NuBloxSQL provides structured, capability-aware DDL compiler scopes for PostgreSQL, MySQL and SQLite:

- `ddl-v1` — create/drop schema objects and table definitions;
- `ddl-v2` — a deliberately narrow portable ALTER TABLE lifecycle.

Use these APIs when you need to parse, inspect, validate or transpile supported schema statements. They are not a schema-migration framework and do not imply identical physical type/storage semantics across databases.

## `ddl-v1` statements

`ddl-v1` models:

- `CREATE TABLE`;
- `CREATE [UNIQUE] INDEX`;
- partial indexes where the target capability is available;
- `CREATE VIEW ... AS <query>`;
- basic `CREATE SCHEMA`;
- basic `CREATE SEQUENCE`;
- `DROP TABLE`;
- `DROP VIEW`.

`CREATE TABLE` supports structured column definitions plus `NOT NULL`, scalar `DEFAULT`, `PRIMARY KEY`, `UNIQUE`, `CHECK` and basic foreign-key `REFERENCES`.

## Parse DDL into an AST

```js
const { capabilityModel } = require('nubloxsql');

const ast = capabilityModel.parseSql(
  'postgresql',
  `CREATE TABLE ledger (
     id INTEGER PRIMARY KEY,
     name VARCHAR(100) NOT NULL UNIQUE,
     amount DECIMAL(12,2) DEFAULT 0 CHECK (amount >= 0)
   )`
);

console.log(ast.type); // CreateTableStatement
console.log(capabilityModel.analyzeAst(ast).scope); // ddl-v1
```

Type names/modifiers, identifiers, defaults and constraints are structured AST data rather than arbitrary source fragments.

## Compile versus transpile

`compileAst(target, ast)` renders a validated AST for one target but does not run source-to-target capability planning.

Use `transpileSql()` when moving SQL between dialects:

```js
const result = capabilityModel.transpileSql(
  'postgresql',
  'mysql',
  `CREATE TABLE ledger (
     id INTEGER PRIMARY KEY,
     name VARCHAR(100) NOT NULL,
     amount DECIMAL(12,2) DEFAULT 0 CHECK (amount >= 0)
   )`
);

console.log(result.scope);     // ddl-v1
console.log(result.certified); // capability plan certified
```

Certification applies to the modeled DDL semantics. It does not assert identical affinity, collation, storage layout, coercion, precision or overflow behavior.

## Runtime-dependent capabilities

Provide live qualification when a capability is version/runtime dependent:

```js
const runtime = await capabilityModel.qualifyClient(db);

const result = capabilityModel.transpileSql(
  'postgresql',
  'sqlite',
  'CREATE INDEX positive_idx ON ledger (id) WHERE amount > 0',
  { targetQualification: runtime }
);
```

If required evidence is unresolved, transpilation fails instead of assuming support.

## Partial indexes

MySQL does not expose an equivalent partial-index capability in the current compiler scope. NuBloxSQL therefore rejects this target instead of dropping the predicate and creating a different full index.

## Foreign keys

`ddl-v1` models local/referenced column lists and validates column-count consistency. SQLite foreign-key capability may require runtime/configuration evidence.

Foreign-key `ON DELETE`/`ON UPDATE`, `MATCH`, deferrability and named constraints remain outside the released scope and are rejected rather than discarded.

## Views

`CREATE VIEW` reuses the released query compiler. The view body is a real query AST, so capabilities required by CTEs, set operations, CASE/CAST and windows participate in the DDL plan. Bind parameters are rejected from persisted view definitions.

## Schemas and sequences

PostgreSQL supports the released basic forms. NuBloxSQL does not automatically treat MySQL `CREATE DATABASE` as a lossless rewrite of PostgreSQL `CREATE SCHEMA`; the capability model records it as an equivalent construct requiring an explicit semantic policy. SQLite schema/sequence targets and MySQL sequence targets fail closed.

# ALTER TABLE lifecycle (`ddl-v2`)

Wave 5b models four atomic lifecycle operations:

```sql
ALTER TABLE ledger ADD COLUMN note VARCHAR(120)
ALTER TABLE ledger DROP COLUMN note
ALTER TABLE ledger RENAME COLUMN note TO memo
ALTER TABLE ledger RENAME TO ledger_archive
```

The AST uses `AlterTableStatement` with one of:

- `AddColumnAction`;
- `DropColumnAction`;
- `RenameColumnAction`;
- `RenameTableAction`.

Each operation maps to its own capability ID:

```text
schema.tableAlter.addColumn
schema.tableAlter.dropColumn
schema.tableAlter.renameColumn
schema.tableAlter.renameTable
```

This is important because a dialect can support only part of ALTER TABLE. NuBloxSQL does not collapse these operations into a single optimistic `alterTable = true` flag.

## SQLite version gating

SQLite ALTER support changed over time. NuBloxSQL models:

- `RENAME COLUMN` from SQLite 3.25.0;
- `DROP COLUMN` from SQLite 3.35.0.

These operations are runtime-version qualified:

```js
const runtime = await capabilityModel.qualifyClient(sqliteDb);

const rename = capabilityModel.transpileSql(
  'postgresql',
  'sqlite',
  'ALTER TABLE ledger RENAME COLUMN note TO memo',
  { targetQualification: runtime }
);
```

Version evidence also applies to the **source** dialect. If SQLite is the source of a version-dependent ALTER statement, supply `sourceQualification`; NuBloxSQL will not assume an older SQLite installation supported modern syntax.

```js
const result = capabilityModel.transpileSql(
  'sqlite',
  'postgresql',
  'ALTER TABLE ledger DROP COLUMN obsolete',
  { sourceQualification: sqliteRuntime }
);
```

## ADD COLUMN is intentionally conservative

`ddl-v2` currently permits only a plain column name and type:

```sql
ALTER TABLE ledger ADD COLUMN note VARCHAR(120)
```

It rejects ALTER-time defaults, nullability constraints, keys, checks and references. Those constructs have materially different restrictions and existing-row effects across engines, particularly SQLite. NuBloxSQL will model them only when their ALTER-specific semantics can be qualified honestly.

For example, this is rejected by the current scope:

```sql
ALTER TABLE ledger ADD COLUMN active INTEGER NOT NULL DEFAULT 1
```

That is deliberate; the compiler does not strip clauses to make the statement fit a target.

## Validation

The released DDL validator rejects, among other things:

- duplicate CREATE TABLE columns;
- multiple primary keys;
- constraints referencing unknown local columns;
- mismatched foreign-key column counts;
- bind parameters in persisted DDL definitions;
- unsupported foreign-key options;
- ADD COLUMN constraints/defaults in `ddl-v2`;
- rename operations where old and new names are identical;
- unmodeled ALTER actions such as `ALTER COLUMN TYPE`;
- multi-action ALTER statements.

Unknown syntax must not turn into silently altered schema SQL.

## Current boundary

The released DDL compiler does **not** yet claim:

- `IF EXISTS` / `IF NOT EXISTS`;
- generated or identity columns;
- named constraints or constraint lifecycle operations;
- foreign-key actions/match/deferrability;
- `CREATE TABLE AS`;
- ALTER COLUMN type/default/nullability changes;
- constrained/defaulted ADD COLUMN semantics;
- multi-action ALTER TABLE;
- `DROP INDEX`, `DROP SCHEMA` or `DROP SEQUENCE` compiler nodes;
- expression indexes;
- index methods, included columns or vendor index options;
- sequence start/increment/cache/cycle options;
- partitioning, table engines, tablespaces, clustering or distribution clauses;
- vendor-specific physical design/locking/algorithm modifiers.

Use `capabilityOntology.implementation(feature)` to distinguish engine support from NuBlox compiler coverage.

## TypeScript

DDL AST declarations are exported from `types/ddl.d.ts`:

```ts
import type {
  SqlDdlAst,
  SqlCreateTableStatementAst,
  SqlAlterTableStatementAst,
  SqlAlterTableActionAst,
  SqlDdlCompilerScope
} from 'nubloxsql';
```

`SqlStatementAst` includes query, DML and DDL statements, so normal discriminated-union narrowing works on `statement.type`.

## Qualification

The DDL compiler is qualified through:

- static AST/compiler contracts;
- TypeScript declaration contracts;
- live PostgreSQL 15–18 execution;
- live MySQL 8.4/9.7 execution;
- SQLite execution on Node 22/24/26;
- packed-package JavaScript and strict TypeScript consumers;
- Tier-1 evidence and release audits.

Wave 5b's live lifecycle test performs ADD COLUMN, RENAME COLUMN, RENAME TABLE and DROP COLUMN against the same real table and verifies that surviving data remains readable after every transition.

See [Capabilities and SQL portability](11-capabilities-and-portability.md) for capability resolution and [Metadata and introspection](07-metadata-and-introspection.md) for inspecting deployed schema state.
