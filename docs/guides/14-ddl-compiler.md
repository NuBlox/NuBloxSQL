# DDL compiler guide

NuBloxSQL provides structured, capability-aware DDL compiler scopes for PostgreSQL, MySQL and SQLite:

- `ddl-v1` — create/drop schema objects and structured table definitions;
- `ddl-v2` — atomic add/drop/rename table-column lifecycle;
- `ddl-v3` — column type/default/nullability and named constraint lifecycle;
- `ddl-v4` — schema-object drops and statement-specific existence modifiers;
- `ddl-v5` — PostgreSQL concurrent index lifecycle and explicit DROP dependency behavior;
- `ddl-v6` — generated-expression columns and PostgreSQL SQL-standard identity columns;
- `ddl-v7` — foreign-key actions, match modes and deferrability semantics;
- `ddl-v8` — expression/functional index keys plus PostgreSQL covering/access-method semantics.

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

## `ddl-v6`: generated and identity columns

`ddl-v6` adds structured column-generation semantics without collapsing distinct identity mechanisms across engines.

### Generated columns

The released grammar is explicit:

```sql
CREATE TABLE totals (
  price DECIMAL(10,2),
  qty INTEGER,
  total DECIMAL(12,2)
    GENERATED ALWAYS AS (price * qty) STORED
)
```

The AST represents the generated clause separately from the base column:

```js
const ast = capabilityModel.parseSql('postgresql', sqlText);

console.log(ast.columns[2].generated.storage); // stored
console.log(ast.columns[2].generated.expression.type); // BinaryExpression
```

Capability analysis includes:

```text
integrity.generatedColumns
integrity.generatedStored
integrity.generatedVirtual
```

PostgreSQL and MySQL stored generated columns are the qualified common native subset. SQLite reports generated-column support as runtime/version dependent, so cross-dialect certification to SQLite requires `qualifyClient()` or another valid runtime qualification.

Generated expressions reuse the normal expression AST. The ddl-v6 subset rejects bind parameters, subqueries, windows and wildcards. It also requires explicit `STORED` or `VIRTUAL` and requires the generated clause to be the final column clause in this compiler scope.

### PostgreSQL virtual generated columns

PostgreSQL virtual generated columns are version-sensitive. NuBloxSQL requires explicit PostgreSQL 18+ evidence for both source and target when a `VIRTUAL` generated column is compiled/transpiled.

```js
const runtime = await capabilityModel.qualifyClient(pg18Client);

const result = capabilityModel.transpileSql(
  'postgresql',
  'postgresql',
  'CREATE TABLE totals (a INTEGER, b INTEGER, total INTEGER GENERATED ALWAYS AS (a + b) VIRTUAL)',
  { sourceQualification: runtime, targetQualification: runtime }
);
```

A PostgreSQL 15–17 qualification cannot certify that statement.

### SQL-standard identity

The released identity forms are:

```sql
id BIGINT GENERATED ALWAYS AS IDENTITY
id BIGINT GENERATED BY DEFAULT AS IDENTITY
```

The AST records `identity.mode` as `always` or `by-default`, with capabilities:

```text
integrity.identity
integrity.identityAlways
integrity.identityByDefault
```

This ddl-v6 identity surface is intentionally PostgreSQL-standard semantics. NuBloxSQL does not automatically lower it to MySQL `AUTO_INCREMENT`, SQLite `INTEGER PRIMARY KEY`, or SQLite `AUTOINCREMENT`. Those mechanisms have different allocation, override, sequence and lifecycle semantics and require explicit future semantic nodes/lowering rules.

Identity options such as start/increment/min/max/cache/cycle are outside the current ddl-v6 subset.

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
- `DROP INDEX CONCURRENTLY ... CASCADE`;
- generated/identity columns combined with a ddl-v6 `DEFAULT`;
- generated expressions containing parameters/windows/subqueries/wildcards;
- PostgreSQL virtual generated columns without PostgreSQL 18+ evidence;
- automatic SQL-standard identity lowering to MySQL/SQLite identity mechanisms.

Unknown syntax must not turn into plausible-but-different schema SQL.

## `ddl-v7`: foreign-key semantics

`ddl-v7` gives foreign keys a structured semantic model instead of treating the tail of a reference clause as opaque SQL.

Supported fields include:

- `ON DELETE` and `ON UPDATE` with `NO ACTION`, `RESTRICT`, `CASCADE`, `SET NULL`, and `SET DEFAULT` where the target genuinely supports them;
- `MATCH SIMPLE`, `MATCH FULL`, and `MATCH PARTIAL` where supported;
- `DEFERRABLE` / `NOT DEFERRABLE`;
- `INITIALLY DEFERRED` / `INITIALLY IMMEDIATE`;
- named `ALTER TABLE ... ADD CONSTRAINT ... FOREIGN KEY`.

PostgreSQL exposes the broadest released semantics. MySQL action behavior is capability-gated and deferred constraints are rejected. SQLite requires runtime qualification for foreign-key behavior because enforcement is connection/runtime dependent.

Cross-dialect compilation is deliberately conservative. NuBloxSQL does not erase MySQL/PostgreSQL timing differences, fabricate unsupported `MATCH` semantics, lower deferred constraints to immediate constraints, or assume `SET DEFAULT` is valid on an engine where it is not.

## `ddl-v8`: advanced index semantics

`ddl-v8` models index key expressions explicitly.

PostgreSQL and SQLite use the `schema.expressionIndex` family. MySQL uses the distinct `schema.functionalIndex` family and renders functional key parts with the required nested-parenthesis syntax.

PostgreSQL also supports:

```sql
CREATE INDEX ledger_search_idx
ON ledger USING btree ((lower(code)))
INCLUDE (id)
```

The released access-method set is `btree`, `hash`, `gist`, `spgist`, `gin` and `brin`. User-defined PostgreSQL access methods need catalog-aware qualification and are outside this scope.

SQLite expression indexes require runtime version qualification (3.9.0 or newer). NuBloxSQL does not silently translate PostgreSQL/SQLite expression-index semantics to MySQL functional indexes or vice versa.

## Current boundary

The released DDL compiler still does **not** claim:

- identity sequence options;
- explicit MySQL `AUTO_INCREMENT` semantic nodes;
- explicit SQLite ROWID/AUTOINCREMENT semantic nodes;
- `CREATE TABLE AS`;
- constrained/defaulted ADD COLUMN semantics;
- automatic MySQL `MODIFY COLUMN` lowering;
- automatic SQLite table-rebuild migrations;
- multi-action ALTER TABLE;
- operator classes/families, index collations and per-key sort/null-order options;
- MySQL invisible/multi-valued/full-text/spatial index semantics;
- general vendor index storage/algorithm options;
- sequence start/increment/cache/cycle options;
- multi-object drops;
- concurrent reindex or cross-vendor online-index equivalence;
- partitioning, table engines, tablespaces, clustering or distribution clauses;
- vendor-specific physical design/locking/algorithm modifiers.

Use `capabilityOntology.implementation(feature)` to distinguish database support from NuBlox compiler coverage.

## TypeScript

DDL AST declarations are exported from `types/ddl.d.ts`, including `SqlDdlAst`, ALTER action types, object-drop nodes, `SqlDropDependencyMode`, `SqlAstGeneratedColumn`, `SqlAstIdentityColumn`, foreign-key action/match/initial-mode types, index-key AST types and `SqlDdlCompilerScope`. `SqlStatementAst` includes query, DML and DDL statements, so normal discriminated-union narrowing works on `statement.type` and `statement.action.type`.

## Qualification

The DDL compiler is qualified through:

- static AST/compiler contracts;
- TypeScript declaration contracts;
- live PostgreSQL 15–18 execution;
- live MySQL 8.4/9.7 execution for portable DDL scopes;
- SQLite execution/fail-closed evidence on Node 22/24/26;
- packed-package JavaScript and strict TypeScript consumers;
- Tier-1 evidence and release audits.

Wave 5b exercises add/drop/rename lifecycle. Wave 5c exercises default changes on PostgreSQL/MySQL plus PostgreSQL type/nullability and named constraints. Wave 5d exercises safe existence modifiers and object drops, including engine-specific index identity behavior. Wave 5e exercises PostgreSQL concurrent index creation/removal and explicit CASCADE/RESTRICT dependency behavior. Wave 5f executes stored generated columns on PostgreSQL/MySQL/SQLite, PostgreSQL identity on PostgreSQL 15–18, and virtual generation when PostgreSQL 18 qualifies it. Wave 5g executes foreign-key semantics across Tier-1 engines with explicit vendor boundaries. Wave 5h executes PostgreSQL/SQLite expression indexes, MySQL functional key parts, and PostgreSQL INCLUDE/access-method syntax.

See [Capabilities and SQL portability](11-capabilities-and-portability.md) for capability resolution and [Metadata and introspection](07-metadata-and-introspection.md) for deployed schema state.
