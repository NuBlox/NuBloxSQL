# DDL compiler guide

NuBloxSQL provides structured, capability-aware DDL compiler scopes for PostgreSQL, MySQL and SQLite:

- `ddl-v1` — create/drop schema objects and structured table definitions;
- `ddl-v2` — atomic add/drop/rename table-column lifecycle;
- `ddl-v3` — column type/default/nullability and named constraint lifecycle;
- `ddl-v4` — schema-object drops and statement-specific existence modifiers;
- `ddl-v5` — PostgreSQL concurrent index lifecycle and explicit DROP dependency behavior.

Use these APIs to parse, inspect, validate or transpile supported schema statements. They are not a schema-migration framework, and certification never implies identical storage, affinity, collation, coercion or physical-design semantics.

## `ddl-v1`: DDL foundation

`ddl-v1` models:

- `CREATE TABLE`;
- `CREATE [UNIQUE] INDEX` and partial indexes where available;
- `CREATE VIEW ... AS <query>`;
- basic `CREATE SCHEMA` and `CREATE SEQUENCE`;
- `DROP TABLE` and `DROP VIEW`.

`CREATE TABLE` uses structured column/type definitions with `NOT NULL`, scalar `DEFAULT`, `PRIMARY KEY`, `UNIQUE`, `CHECK` and basic foreign-key `REFERENCES`.

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

console.log(capabilityModel.analyzeAst(ast).scope); // ddl-v1
```

`CREATE VIEW` reuses the released query compiler, so CTE/set/window/expression capabilities in the view body remain part of the plan. Bind parameters are rejected from persisted view definitions.

MySQL partial-index targets fail closed rather than losing the predicate. `CREATE SCHEMA` is not automatically translated to MySQL `CREATE DATABASE`, because equivalence of names does not prove equivalence of namespace semantics.

## `ddl-v2`: ALTER TABLE lifecycle

`ddl-v2` models:

```sql
ALTER TABLE ledger ADD COLUMN note VARCHAR(120)
ALTER TABLE ledger DROP COLUMN note
ALTER TABLE ledger RENAME COLUMN note TO memo
ALTER TABLE ledger RENAME TO ledger_archive
```

Each action maps to a separate `schema.tableAlter.*` capability. SQLite `RENAME COLUMN` is version-gated from 3.25.0 and `DROP COLUMN` from 3.35.0.

Use runtime qualification for version-sensitive targets:

```js
const runtime = await capabilityModel.qualifyClient(sqliteDb);

const result = capabilityModel.transpileSql(
  'postgresql',
  'sqlite',
  'ALTER TABLE ledger RENAME COLUMN note TO memo',
  { targetQualification: runtime }
);
```

`ADD COLUMN` deliberately permits only a plain column name and type. Defaults, nullability constraints, keys, checks and references remain outside `ddl-v2` because existing-row effects differ materially by engine.

## `ddl-v3`: column and constraint lifecycle

`ddl-v3` adds:

```text
schema.tableAlter.alterColumnType
schema.tableAlter.setDefault
schema.tableAlter.dropDefault
schema.tableAlter.setNotNull
schema.tableAlter.dropNotNull
schema.tableAlter.addConstraint
schema.tableAlter.dropConstraint
```

Supported SQL includes:

```sql
ALTER TABLE ledger ALTER COLUMN amount TYPE DECIMAL(18,4)
ALTER TABLE ledger ALTER COLUMN amount SET DEFAULT 0
ALTER TABLE ledger ALTER COLUMN amount DROP DEFAULT
ALTER TABLE ledger ALTER COLUMN code SET NOT NULL
ALTER TABLE ledger ALTER COLUMN code DROP NOT NULL
ALTER TABLE ledger ADD CONSTRAINT ledger_amount_positive CHECK (amount >= 0)
ALTER TABLE ledger DROP CONSTRAINT ledger_amount_positive
```

Named `ADD CONSTRAINT` currently understands `PRIMARY KEY`, `UNIQUE`, `CHECK` and basic `FOREIGN KEY (...) REFERENCES ... (...)` structures.

### PostgreSQL/MySQL default lifecycle

`SET DEFAULT` and `DROP DEFAULT` are modeled as native on both PostgreSQL and MySQL:

```js
const result = capabilityModel.transpileSql(
  'postgresql',
  'mysql',
  'ALTER TABLE ledger ALTER COLUMN amount SET DEFAULT 0'
);

console.log(result.scope);     // ddl-v3
console.log(result.certified); // true
```

Default expressions are AST expressions, so CASE/CAST and other expression capabilities remain part of the capability plan.

### Type/nullability changes fail closed across PostgreSQL/MySQL

PostgreSQL exposes direct `ALTER COLUMN ... TYPE`, `SET NOT NULL` and `DROP NOT NULL`. MySQL commonly requires `MODIFY COLUMN`/`CHANGE COLUMN` with a complete resulting column definition.

NuBloxSQL therefore records an equivalent semantic family requiring explicit lowering rather than guessing missing column attributes. Cross-dialect type/nullability transpilation fails until a metadata-driven lowering strategy is supplied.

### Constraint lifecycle is explicit

PostgreSQL's generic named constraint lifecycle is modeled directly. MySQL constraint-drop syntax differs by constraint kind, so generic PostgreSQL `ADD/DROP CONSTRAINT` is not certified as a lossless MySQL rewrite.

SQLite receives no fake ddl-v3 support. A safe implementation generally requires a table-rebuild migration, which will be a separate migration-planner strategy rather than hidden inside direct SQL rendering.

## `ddl-v4`: schema-object lifecycle and existence modifiers

`ddl-v4` introduces object lifecycle semantics that cannot safely be represented by a single generic `DROP` flag.

### Existence modifiers

NuBloxSQL models statement-specific capabilities such as:

```text
syntax.existence.createTableIfNotExists
syntax.existence.createIndexIfNotExists
syntax.existence.createSchemaIfNotExists
syntax.existence.createSequenceIfNotExists
syntax.existence.dropTableIfExists
syntax.existence.dropViewIfExists
syntax.existence.dropIndexIfExists
syntax.existence.dropSchemaIfExists
syntax.existence.dropSequenceIfExists
```

This matters because the support matrix differs by statement. PostgreSQL and SQLite support `CREATE INDEX IF NOT EXISTS`; the released MySQL capability profile does not.

```js
const created = capabilityModel.transpileSql(
  'postgresql',
  'sqlite',
  'CREATE INDEX IF NOT EXISTS ledger_id_idx ON ledger (id)'
);

const dropped = capabilityModel.transpileSql(
  'postgresql',
  'sqlite',
  'DROP INDEX IF EXISTS ledger_id_idx'
);
```

### DROP INDEX identity

PostgreSQL/SQLite identify the index directly:

```sql
DROP INDEX IF EXISTS ledger_id_idx
```

MySQL uses a table-scoped form:

```sql
DROP INDEX ledger_id_idx ON ledger
```

NuBloxSQL preserves that semantic difference. It will not infer the MySQL table name or erase the table identity when moving in the other direction. Cross-family DROP INDEX therefore fails closed until an explicit metadata-backed identity transform exists.

### DROP SCHEMA semantics

PostgreSQL schemas are namespaces. MySQL treats `SCHEMA` as a synonym for database. Both engines can execute their own `DROP SCHEMA [IF EXISTS]` form, but NuBloxSQL does not certify PostgreSQL↔MySQL translation as lossless.

SQLite has no supported ddl-v4 `DROP SCHEMA` target.

### Sequence lifecycle

`CREATE SEQUENCE IF NOT EXISTS` and `DROP SEQUENCE IF EXISTS` are currently PostgreSQL-only in the Tier-1 compiler profile. MySQL and SQLite targets fail closed.

## `ddl-v5`: dependency behavior and concurrent indexes

`ddl-v5` deliberately models PostgreSQL-specific lifecycle semantics instead of pretending similarly named vendor features are interchangeable.

### Concurrent index creation

```js
const created = capabilityModel.transpileSql(
  'postgresql',
  'postgresql',
  'CREATE INDEX CONCURRENTLY ledger_amount_idx ON ledger (amount)'
);

console.log(created.scope);     // ddl-v5
console.log(created.certified); // true
```

The AST exposes `concurrently: true` on `CreateIndexStatement`. The required atomic capability is `schema.concurrentIndexBuild`.

PostgreSQL executes `CREATE INDEX CONCURRENTLY` outside an explicit transaction block. NuBloxSQL preserves that native requirement; compilation does not move the operation outside an application transaction automatically.

### Concurrent index removal

```js
const dropped = capabilityModel.transpileSql(
  'postgresql',
  'postgresql',
  'DROP INDEX CONCURRENTLY IF EXISTS ledger_amount_idx RESTRICT'
);
```

The compiler records both `schema.concurrentIndexDrop` and `syntax.dropDependency.restrict`. PostgreSQL does not permit `DROP INDEX CONCURRENTLY ... CASCADE`, so that combination is rejected during validation.

### Explicit dependency behavior

Supported released DROP nodes can carry `dependencyMode: 'cascade' | 'restrict'`:

```js
const result = capabilityModel.transpileSql(
  'postgresql',
  'postgresql',
  'DROP TABLE IF EXISTS ledger CASCADE'
);
```

The atomic capabilities are:

```text
syntax.dropDependency.cascade
syntax.dropDependency.restrict
```

This scope intentionally treats these as PostgreSQL semantics. MySQL and SQLite are marked unsupported for the ddl-v5 dependency capabilities, and PostgreSQL→MySQL/SQLite transpilation fails closed. NuBloxSQL does not infer that a vendor's superficially similar keyword has identical dependency, trigger, locking or transactional behavior.

## Validation and fail-closed behavior

Across the released DDL scopes, validation rejects or blocks cases including:

- duplicate CREATE TABLE columns or multiple primary keys;
- constraints referencing unknown local columns;
- mismatched foreign-key widths;
- bind parameters in persisted defaults/checks/views;
- unsupported foreign-key options;
- constrained/defaulted `ADD COLUMN` in `ddl-v2`;
- same-name renames;
- malformed type modifiers;
- unsafe MySQL `MODIFY COLUMN` inference;
- implicit SQLite table rebuilds;
- MySQL `CREATE INDEX IF NOT EXISTS` / `DROP INDEX IF EXISTS`;
- cross-family MySQL index identity rewrites;
- cross PostgreSQL/MySQL schema/database translation;
- unsupported sequence lifecycle targets;
- non-PostgreSQL ddl-v5 concurrent/dependency syntax;
- `DROP INDEX CONCURRENTLY ... CASCADE`.

Unknown syntax must not turn into plausible-but-different schema SQL.

## Current boundary

The released DDL compiler still does **not** claim:

- generated or identity columns;
- foreign-key actions/match/deferrability;
- `CREATE TABLE AS`;
- constrained/defaulted ADD COLUMN semantics;
- automatic MySQL `MODIFY COLUMN` lowering;
- automatic SQLite table-rebuild migrations;
- multi-action ALTER TABLE;
- expression indexes;
- index methods, included columns or general vendor index options;
- sequence start/increment/cache/cycle options;
- multi-object drops;
- concurrent reindex or cross-vendor online-index equivalence;
- partitioning, table engines, tablespaces, clustering or distribution clauses;
- vendor-specific physical design/locking/algorithm modifiers.

Use `capabilityOntology.implementation(feature)` to distinguish database support from NuBlox compiler coverage.

## TypeScript

DDL AST declarations are exported from `types/ddl.d.ts`, including `SqlDdlAst`, ALTER action types, object-drop nodes, `SqlDropDependencyMode` and `SqlDdlCompilerScope`. `SqlStatementAst` includes query, DML and DDL statements, so normal discriminated-union narrowing works on `statement.type` and `statement.action.type`.

## Qualification

The DDL compiler is qualified through:

- static AST/compiler contracts;
- TypeScript declaration contracts;
- live PostgreSQL 15–18 execution;
- live MySQL 8.4/9.7 execution for portable earlier DDL scopes;
- SQLite execution/fail-closed evidence on Node 22/24/26;
- packed-package JavaScript and strict TypeScript consumers;
- Tier-1 evidence and release audits.

Wave 5b exercises add/drop/rename lifecycle. Wave 5c exercises default changes on PostgreSQL/MySQL plus PostgreSQL type/nullability and named constraints. Wave 5d exercises safe existence modifiers and object drops, including engine-specific index identity behavior. Wave 5e exercises PostgreSQL concurrent index creation/removal and explicit CASCADE/RESTRICT dependency behavior while proving non-PostgreSQL targets fail closed.

See [Capabilities and SQL portability](11-capabilities-and-portability.md) for capability resolution and [Metadata and introspection](07-metadata-and-introspection.md) for deployed schema state.
