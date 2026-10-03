# DDL compiler guide

NuBloxSQL provides structured, capability-aware DDL compiler scopes for PostgreSQL, MySQL and SQLite:

- `ddl-v1` — create/drop schema objects and table definitions;
- `ddl-v2` — atomic add/drop/rename table-column lifecycle;
- `ddl-v3` — column type/default/nullability and named constraint lifecycle with explicit dialect boundaries.

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

`compileAst(target, ast)` renders a validated AST for one target but does not replace source-to-target capability planning.

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
```

Certification applies only to the modeled DDL semantics. It does not assert identical affinity, collation, storage layout, coercion, precision or overflow behavior.

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

Foreign-key `ON DELETE`/`ON UPDATE`, `MATCH`, deferrability and vendor-specific options remain outside the released scope and are rejected rather than discarded.

## Views

`CREATE VIEW` reuses the released query compiler. The view body is a real query AST, so capabilities required by CTEs, set operations, CASE/CAST and windows participate in the DDL plan. Bind parameters are rejected from persisted view definitions.

## Schemas and sequences

PostgreSQL supports the released basic forms. NuBloxSQL does not automatically treat MySQL `CREATE DATABASE` as a lossless rewrite of PostgreSQL `CREATE SCHEMA`; the capability model records it as an equivalent construct requiring explicit semantic policy. SQLite schema/sequence targets and MySQL sequence targets fail closed.

# ALTER TABLE lifecycle (`ddl-v2`)

`ddl-v2` models four atomic lifecycle operations:

```sql
ALTER TABLE ledger ADD COLUMN note VARCHAR(120)
ALTER TABLE ledger DROP COLUMN note
ALTER TABLE ledger RENAME COLUMN note TO memo
ALTER TABLE ledger RENAME TO ledger_archive
```

The AST uses `AlterTableStatement` with one of `AddColumnAction`, `DropColumnAction`, `RenameColumnAction` or `RenameTableAction`.

Each operation maps to its own capability ID under `schema.tableAlter.*`. NuBloxSQL therefore does not collapse partially supported ALTER TABLE families into a single optimistic boolean.

## SQLite version gating

SQLite ALTER support changed over time. NuBloxSQL models:

- `RENAME COLUMN` from SQLite 3.25.0;
- `DROP COLUMN` from SQLite 3.35.0.

Use live qualification for version-sensitive operations:

```js
const runtime = await capabilityModel.qualifyClient(sqliteDb);

const rename = capabilityModel.transpileSql(
  'postgresql',
  'sqlite',
  'ALTER TABLE ledger RENAME COLUMN note TO memo',
  { targetQualification: runtime }
);
```

Version evidence also applies to the source dialect when the source capability is version-dependent.

## ADD COLUMN is intentionally conservative

`ddl-v2` permits a plain column name and type only. ALTER-time defaults, nullability constraints, keys, checks and references remain excluded because existing-row effects and restrictions differ materially across engines.

# Column and constraint lifecycle (`ddl-v3`)

Wave 5c adds seven explicit semantic actions:

```text
schema.tableAlter.alterColumnType
schema.tableAlter.setDefault
schema.tableAlter.dropDefault
schema.tableAlter.setNotNull
schema.tableAlter.dropNotNull
schema.tableAlter.addConstraint
schema.tableAlter.dropConstraint
```

The corresponding SQL subset is:

```sql
ALTER TABLE ledger ALTER COLUMN amount TYPE DECIMAL(18,4)
ALTER TABLE ledger ALTER COLUMN amount SET DEFAULT 0
ALTER TABLE ledger ALTER COLUMN amount DROP DEFAULT
ALTER TABLE ledger ALTER COLUMN code SET NOT NULL
ALTER TABLE ledger ALTER COLUMN code DROP NOT NULL
ALTER TABLE ledger ADD CONSTRAINT ledger_amount_positive CHECK (amount >= 0)
ALTER TABLE ledger DROP CONSTRAINT ledger_amount_positive
```

Named `ADD CONSTRAINT` currently supports `PRIMARY KEY`, `UNIQUE`, `CHECK` and basic `FOREIGN KEY (...) REFERENCES ... (...)` structures.

## PostgreSQL and MySQL defaults

`ALTER COLUMN ... SET DEFAULT` and `DROP DEFAULT` are modeled as native on both PostgreSQL and MySQL and can be transpiled between them when all expression capabilities are also supported:

```js
const result = capabilityModel.transpileSql(
  'postgresql',
  'mysql',
  'ALTER TABLE ledger ALTER COLUMN amount SET DEFAULT 0'
);

console.log(result.scope);     // ddl-v3
console.log(result.certified); // true
```

Default expressions are AST expressions, not raw SQL. CASE/CAST and other modeled expression capabilities are therefore included in the capability plan.

## Type and nullability changes fail closed across PostgreSQL/MySQL

PostgreSQL exposes direct `ALTER COLUMN ... TYPE`, `SET NOT NULL` and `DROP NOT NULL` forms. MySQL commonly requires `MODIFY COLUMN`/`CHANGE COLUMN` with a complete resulting column definition.

NuBloxSQL records that as an **equivalent semantic family requiring explicit lowering**, not as a lossless syntax alias. This therefore fails:

```js
capabilityModel.transpileSql(
  'postgresql',
  'mysql',
  'ALTER TABLE ledger ALTER COLUMN amount TYPE BIGINT'
);
```

The failure is intentional. A future lowering strategy can use introspected column metadata to construct a complete MySQL definition safely; ddl-v3 does not guess missing attributes.

## Constraint lifecycle is explicit

PostgreSQL's generic named constraint lifecycle is modeled directly. MySQL constraint-drop syntax differs by constraint kind (`DROP FOREIGN KEY`, `DROP CHECK`, index-backed unique handling, and so on), so ddl-v3 does not treat generic PostgreSQL `DROP CONSTRAINT name` as losslessly portable to MySQL.

The same principle applies to `ADD CONSTRAINT`: NuBloxSQL understands the structured constraint but does not certify cross-family behavior where target semantics are only partial.

## SQLite does not receive fake ALTER COLUMN support

SQLite's direct ALTER TABLE grammar does not provide this ddl-v3 lifecycle. Safe implementation generally requires a table-rebuild migration that recreates schema objects and copies data.

NuBloxSQL therefore reports these capabilities as unsupported in ddl-v3 and rejects direct transpilation. A future migration-planner layer may provide an explicit rebuild strategy; it will not be hidden inside a simple renderer.

## Validation

The released DDL validator rejects, among other things:

- duplicate CREATE TABLE columns;
- multiple primary keys;
- constraints referencing unknown local columns;
- mismatched foreign-key column counts;
- bind parameters in persisted DDL/default/check expressions;
- unsupported foreign-key options;
- constrained/defaulted ADD COLUMN semantics in `ddl-v2`;
- same-name rename operations;
- malformed type modifiers;
- mismatched foreign-key widths in `ddl-v3`;
- dialect source syntax that would require a different semantic family;
- multi-action ALTER statements.

Unknown syntax must not turn into silently altered schema SQL.

## Current boundary

The released DDL compiler does **not** yet claim:

- `IF EXISTS` / `IF NOT EXISTS`;
- generated or identity columns;
- foreign-key actions/match/deferrability;
- `CREATE TABLE AS`;
- constrained/defaulted ADD COLUMN semantics;
- automatic MySQL `MODIFY COLUMN` lowering;
- automatic SQLite table-rebuild migrations;
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
  SqlAlterTableStatementAst,
  SqlAlterTableActionAst,
  SqlAlterColumnTypeActionAst,
  SqlSetColumnDefaultActionAst,
  SqlAddConstraintActionAst,
  SqlDdlCompilerScope
} from 'nubloxsql';
```

`SqlStatementAst` includes query, DML and DDL statements, so normal discriminated-union narrowing works on `statement.type` and `statement.action.type`.

## Qualification

The DDL compiler is qualified through:

- static AST/compiler contracts;
- TypeScript declaration contracts;
- live PostgreSQL 15–18 execution;
- live MySQL 8.4/9.7 execution;
- SQLite fail-closed/runtime evidence on Node 22/24/26;
- packed-package JavaScript and strict TypeScript consumers;
- Tier-1 evidence and release audits.

Wave 5b's live test exercises ADD/DROP/RENAME lifecycle against real tables. Wave 5c additionally executes default changes on PostgreSQL/MySQL, PostgreSQL type/nullability changes, named CHECK add/drop, and explicit SQLite rejection.

See [Capabilities and SQL portability](11-capabilities-and-portability.md) for capability resolution and [Metadata and introspection](07-metadata-and-introspection.md) for inspecting deployed schema state.
