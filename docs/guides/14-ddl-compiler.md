# DDL compiler guide

NuBloxSQL `ddl-v1` provides a structured, capability-aware schema compiler for the portable DDL subset that has been qualified across PostgreSQL, MySQL and SQLite.

Use it when you need to parse, inspect, validate or transpile supported schema statements. It is not a schema-migration framework and does not assume that similarly named SQL types have identical physical semantics across databases.

## Supported statements

`ddl-v1` currently models:

- `CREATE TABLE`;
- `CREATE [UNIQUE] INDEX`;
- partial indexes where the target capability is available;
- `CREATE VIEW ... AS <query>`;
- basic `CREATE SCHEMA`;
- basic `CREATE SEQUENCE`;
- `DROP TABLE`;
- `DROP VIEW`.

`CREATE TABLE` supports structured column definitions plus:

- `NOT NULL` / explicit `NULL`;
- scalar `DEFAULT` expressions;
- column and table `PRIMARY KEY`;
- column and table `UNIQUE`;
- column and table `CHECK`;
- column/table foreign-key `REFERENCES`.

## Parse DDL into an AST

```js
const { capabilityModel } = require('nubloxsql');

const ast = capabilityModel.parseSql(
  'postgresql',
  `CREATE TABLE ledger (
     id INTEGER PRIMARY KEY,
     tenant_id INTEGER NOT NULL,
     name VARCHAR(100) NOT NULL UNIQUE,
     amount DECIMAL(12,2) DEFAULT 0 CHECK (amount >= 0)
   )`
);

console.log(ast.type); // CreateTableStatement
console.log(ast.columns[3].dataType);
// { type: 'TypeName', name: 'DECIMAL', modifiers: [12, 2] }
```

The AST stores identifiers, type names/modifiers, defaults and constraints as structured data rather than preserving arbitrary source fragments.

## Inspect required capabilities

```js
const analysis = capabilityModel.analyzeAst(ast);

console.log(analysis.scope); // ddl-v1
console.log(analysis.capabilities);
```

For the example above the capability set includes `statements.createTable` and the relevant integrity capabilities such as `integrity.primaryKey`, `integrity.notNull`, `integrity.unique` and `integrity.check`.

This capability set is passed to the same rewrite planner used by the query and DML compiler. NuBloxSQL therefore cannot silently emit a target feature that the target capability profile says is unsupported or unresolved.

## Compile for one target

```js
const compiled = capabilityModel.compileAst('mysql', ast);
console.log(compiled.sql);
```

`compileAst()` renders the AST for the requested dialect. It does not run the compatibility planner. Use `transpileSql()` when moving source SQL between dialects and you need capability certification.

## Transpile schema SQL

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

console.log(result.scope);      // ddl-v1
console.log(result.certified);  // true when all modeled target capabilities resolve safely
console.log(result.sql);
```

A certified DDL result means NuBloxSQL has validated the AST and target capability plan for the released `ddl-v1` semantics. It does **not** mean PostgreSQL, MySQL and SQLite use the same storage layout, affinity rules, collation, implicit conversion, precision or overflow behavior.

## Runtime-dependent capabilities

Some SQLite capabilities are runtime-dependent. Provide live qualification when required:

```js
const runtime = await capabilityModel.qualifyClient(db);

const result = capabilityModel.transpileSql(
  'postgresql',
  'sqlite',
  'CREATE INDEX ledger_positive_idx ON ledger (id) WHERE amount > 0',
  { targetQualification: runtime }
);
```

If a capability is unresolved and no qualification is supplied, transpilation fails instead of assuming support.

## Partial indexes

PostgreSQL and SQLite can support index predicates in the qualified profiles; MySQL does not expose an equivalent partial-index capability in this compiler scope.

```js
capabilityModel.transpileSql(
  'postgresql',
  'mysql',
  'CREATE INDEX positive_idx ON ledger (id) WHERE amount > 0'
);
// throws: unsupported target capability
```

NuBloxSQL does not drop the `WHERE` clause and create a semantically different full index.

## Foreign keys

`ddl-v1` models local/referenced column lists and checks that table-level foreign-key column counts match.

```sql
CREATE TABLE child (
  tenant_id INTEGER NOT NULL,
  id INTEGER NOT NULL,
  parent_id INTEGER,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (parent_id) REFERENCES parent (id)
)
```

SQLite foreign-key capability can require runtime qualification because enforcement depends on runtime/configuration evidence.

The following are deliberately outside `ddl-v1`:

- `ON DELETE` / `ON UPDATE` actions;
- `MATCH` options;
- deferrable constraints;
- named constraints.

Do not assume these options will be ignored. The parser rejects them so unsupported semantics cannot disappear during transpilation.

## Views

`CREATE VIEW` reuses the released query compiler:

```js
const result = capabilityModel.transpileSql(
  'postgresql',
  'mysql',
  `CREATE VIEW positive_ledger AS
   SELECT id, amount
   FROM ledger
   WHERE amount > 0`
);
```

The view body is a real query AST. Query capabilities required by CTEs, set operations, CASE/CAST, windows and other released query constructs are therefore included in the DDL capability plan.

Bind parameters are rejected in view definitions because a persisted view cannot safely retain application bind state.

## Schemas and sequences

PostgreSQL supports both in the current Tier-1 profile. The compiler intentionally does not treat MySQL `CREATE DATABASE` as an automatic lossless rewrite of `CREATE SCHEMA`, even though the capability inventory records an equivalent construct.

```js
capabilityModel.transpileSql(
  'postgresql',
  'mysql',
  'CREATE SCHEMA accounting'
);
// throws until an explicit semantic rewrite policy exists
```

SQLite schema/sequence targets fail closed. MySQL sequence targets also fail closed in the current profile.

## Validation rules

The released validator rejects, among other things:

- duplicate column names;
- multiple primary-key declarations;
- table constraints referencing unknown local columns;
- mismatched foreign-key column counts;
- bind parameters in defaults, checks or views;
- window/subquery expressions in DDL scalar positions;
- named constraints;
- unsupported trailing table/index/sequence options.

These failures are intentional. A schema compiler must not turn unknown syntax into silently altered DDL.

## Current boundary

`ddl-v1` does **not** yet claim:

- `IF EXISTS` / `IF NOT EXISTS`;
- generated or identity columns;
- named constraints;
- foreign-key actions/match/deferrability;
- `CREATE TABLE AS`;
- `ALTER TABLE` variants;
- `DROP INDEX`, `DROP SCHEMA` or `DROP SEQUENCE` compiler nodes;
- expression indexes;
- index methods, included columns or vendor index options;
- sequence start/increment/cache/cycle options;
- partitioning, table engines, tablespaces, clustering or distribution clauses;
- vendor-specific physical design options.

Use the capability ontology to distinguish engine support from NuBlox compiler coverage. A database may support one of these features even though `capabilityOntology.implementation(feature)` does not yet report it as implemented by the compiler.

## TypeScript

DDL AST declarations are exported from `types/ddl.d.ts` through the package root:

```ts
import type {
  SqlDdlAst,
  SqlCreateTableStatementAst,
  SqlCreateIndexStatementAst,
  SqlCreateViewStatementAst,
  SqlDdlCompilerScope
} from 'nubloxsql';
```

`SqlStatementAst` includes query, DML and DDL statement unions, so normal discriminated-union narrowing works on `statement.type`.

## Qualification

Wave 5 is release-qualified through:

- static AST/compiler contracts;
- TypeScript declaration contracts;
- live PostgreSQL 15–18 execution;
- live MySQL 8.4/9.7 execution;
- SQLite execution on the supported Node 22/24/26 matrix;
- packed-package JavaScript and strict TypeScript consumer smoke tests;
- Tier-1 evidence and release audits.

See [Capabilities and SQL portability](11-capabilities-and-portability.md) for capability resolution and [Metadata and introspection](07-metadata-and-introspection.md) for inspecting the schema that actually exists after deployment.
