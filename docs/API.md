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
- `structureTree()` / `buildStructureTree()` — canonical hierarchical database structure model built from portable metadata.
- `objectId()` / `parseObjectId()` — deterministic database-object identity.
- `dependencyGraph()` / `buildDependencyGraph()` — database dependency graph derived from metadata.
- `graphDependencies()`, `graphDependents()`, `impactAnalysis()` — dependency and change-impact traversal.
- `capabilityReport()` — static platform capability report.
- `transactionPolicy()` — portable transaction-policy description.
- `capabilityModel` — Tier-1 compatibility, runtime qualification, rewrite and compiler/transpilation APIs.
- `capabilityOntology` — atomic capability definitions, engine observations and NuBlox implementation coverage.
- `productCoverage` — whole-product maturity register across runtime, language, intelligence, portability, platform foundations and dialect depth.
- `typeSemantics` / `canonicalType()` / `nativeTypeMapping()` / `typeCompatibility()` — canonical cross-dialect type analysis and mapping.
- `schemaSnapshot()` / `buildSchemaSnapshot()` — deterministic canonical schema model with semantic/source fingerprints.
- `diffSchemas()` — canonical schema comparison with object/property/dependency changes and safety classification.
- `planMigration()` — dependency-aware migration planning with safety, execution mode, preconditions and target-dialect SQL.
- `executeMigration()` / `resumeMigration()` — controlled migration execution with dry-run, approvals, checkpoints, recovery and post-verification.
- `executeMigration()` / `resumeMigration()` — controlled migration execution with dry-run, approvals, checkpoints, recovery and post-verification.

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
| `dml-v3` | PostgreSQL/SQLite UPDATE FROM and PostgreSQL DELETE USING with one auxiliary table reference |
| `dml-v4` | joined and derived-table auxiliary mutation-source composition |
| `dml-v5` | lossless parameter-origin remapping across rich mutation sources |
| `dml-v6` | native MySQL multi-table UPDATE/DELETE semantic family |
| `dml-v7` | MySQL mutation target aliases, modifiers, and single-table ORDER BY/LIMIT controls |
| `ddl-v1` | structured CREATE TABLE/INDEX/VIEW/SCHEMA/SEQUENCE and DROP TABLE/VIEW |
| `ddl-v2` | atomic ALTER TABLE add/drop/rename-column and rename-table lifecycle operations |
| `ddl-v3` | ALTER COLUMN type/default/nullability and named constraint lifecycle |
| `ddl-v4` | schema-object drop lifecycle plus statement-specific `IF EXISTS` / `IF NOT EXISTS` modifiers |
| `ddl-v5` | PostgreSQL concurrent index lifecycle and explicit DROP dependency behavior |
| `ddl-v6` | generated columns plus PostgreSQL SQL-standard identity columns |
| `ddl-v7` | foreign-key actions, match modes and deferrability semantics |
| `ddl-v8` | expression/functional index keys plus PostgreSQL INCLUDE/access methods |
| `ddl-v9` | per-key ordering/collation plus PostgreSQL NULL placement and operator classes |
| `ddl-v10` | native CREATE TABLE AS query materialisation with engine-local result-schema semantics |

A successful compilation certifies the modeled syntax/capability plan for that scope. It does **not** claim identical vendor coercion, collation, precision, conflict, trigger, storage or physical-design semantics where engines differ.

### Query composition

Set-operation parsing preserves source-dialect precedence in the AST. Unsupported target capabilities fail closed rather than changing semantics. Window nodes model `OVER`, partition/order specifications, frames, `EXCLUDE` and named windows. PostgreSQL `expression::type` is normalized to the structured cast AST.

### DML (`dml-v1` and `dml-v2`)

`dml-v1` uses first-class INSERT/UPDATE/DELETE ASTs and reuses the query/expression compiler. `RETURNING` remains capability-driven: PostgreSQL is native; MySQL is rejected; SQLite requires runtime qualification when its capability state is runtime-dependent.

`dml-v2` represents PostgreSQL/SQLite `ON CONFLICT`, MySQL `ON DUPLICATE KEY UPDATE`, and PostgreSQL `MERGE` as distinct semantic families. NuBloxSQL does not automatically translate materially different conflict semantics.

### Advanced UPDATE/DELETE composition (`dml-v3`)

`dml-v3` adds first-class auxiliary-relation semantics for:

- PostgreSQL `UPDATE ... FROM`;
- SQLite `UPDATE ... FROM`, runtime-version qualified from SQLite 3.33.0;
- PostgreSQL `DELETE ... USING`.

The initial released source shape is one auxiliary table reference with an optional alias. MySQL multi-table UPDATE/DELETE is recorded as a separate native capability family and is not silently treated as PostgreSQL-style `FROM`/`USING`.

### Rich mutation-source composition (`dml-v4`)

`dml-v4` extends the released UPDATE/DELETE composition model so the auxiliary source can be a joined relation graph or a derived table. It reuses the same `SqlAstRelation` and `SqlAstJoin` nodes as SELECT, so join capability analysis remains centralized.

PostgreSQL supports joined/derived `UPDATE ... FROM` and `DELETE ... USING`. SQLite is qualified for joined/derived `UPDATE ... FROM` when runtime evidence satisfies its UPDATE-FROM version floor. MySQL remains a distinct multi-table DML family and is not rewritten as PostgreSQL-style FROM/USING.

`dml-v5` adds source-origin-aware bind handling for parameters inside auxiliary mutation sources. PostgreSQL numbered parameters and SQLite positional, numbered, and named parameters are rebound through one final statement binder so target marker order and `targetToSource` remain correct when the source clause is inserted between SET and WHERE/RETURNING.

### MySQL native multi-table DML (`dml-v6`)

`dml-v6` models MySQL multi-table mutation syntax as its own vendor-specific AST family. It supports joined table-reference graphs for `UPDATE`, qualified assignment targets such as `a.status` and `b.amount`, and both native multi-target `DELETE` forms (`DELETE a, b FROM ...` and `DELETE FROM a, b USING ...`). Parameters are preserved in source occurrence order for MySQL `?` markers.

This family is intentionally same-dialect only. NuBloxSQL does not translate it automatically to PostgreSQL/SQLite `UPDATE ... FROM` or `DELETE ... USING`, because affected-row sets, writable-target semantics, and grammar are not equivalent.

### MySQL mutation controls (`dml-v7`)

`dml-v7` adds MySQL-native mutation controls without changing the portable DML contract. Single-table `UPDATE` supports target aliases, `LOW_PRIORITY`, `IGNORE`, `ORDER BY`, and `LIMIT`. Single-table `DELETE` supports target aliases, `LOW_PRIORITY`, `QUICK`, `IGNORE`, `ORDER BY`, and `LIMIT`. Multi-table UPDATE/DELETE can carry the legal statement modifiers but deliberately reject `ORDER BY` and `LIMIT`.

The parser enforces MySQL modifier ordering, the AST keeps modifiers/order/limit structured, and parameter-origin mapping remains preserved through compilation. These controls are vendor-specific and same-dialect only.

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

Index identity is explicit. PostgreSQL and SQLite drop an index by index identity; MySQL uses `DROP INDEX name ON table`. NuBloxSQL therefore does not infer the MySQL table or silently translate a MySQL table-scoped drop to a PostgreSQL/SQLite object identity.

Likewise, PostgreSQL schemas are namespaces while MySQL treats `SCHEMA` as a database synonym. Same-dialect `DROP SCHEMA` is supported where native, but automatic PostgreSQL↔MySQL schema/database translation fails closed.

`ddl-v4` excludes multi-object drops, vendor locking/algorithm clauses and metadata-inferred object identity.

### PostgreSQL dependency and concurrent index lifecycle (`ddl-v5`)

`ddl-v5` models PostgreSQL-specific physical and dependency semantics explicitly:

- `CREATE [UNIQUE] INDEX CONCURRENTLY`;
- `DROP INDEX CONCURRENTLY`;
- `DROP ... CASCADE` for the released DROP statement families;
- `DROP ... RESTRICT` for the released DROP statement families.

```js
const createIndex = sql.capabilityModel.transpileSql(
  'postgresql',
  'postgresql',
  'CREATE INDEX CONCURRENTLY ledger_amount_idx ON ledger (amount)'
);

const dropTable = sql.capabilityModel.transpileSql(
  'postgresql',
  'postgresql',
  'DROP TABLE IF EXISTS ledger CASCADE'
);
```

These semantics are intentionally **not** lowered to MySQL or SQLite. `schema.concurrentIndexBuild`, `schema.concurrentIndexDrop`, `syntax.dropDependency.cascade`, and `syntax.dropDependency.restrict` are separate atomic capabilities. MySQL/SQLite observations are unsupported for this released compiler scope, so cross-dialect targets fail closed instead of emitting superficially similar SQL.

PostgreSQL does not allow `DROP INDEX CONCURRENTLY ... CASCADE`; ddl-v5 rejects that combination. PostgreSQL concurrent index creation/removal also has native transaction-block restrictions: callers must execute those statements outside an explicit transaction. NuBloxSQL models and validates the SQL semantics but does not silently escape an application transaction.

`ddl-v5` does not yet claim concurrent reindexing, concurrent constraint attachment, vendor online-index equivalents, multi-object concurrent drops, or automatic emulation of dependency behavior.

### Generated and identity columns (`ddl-v6`)

`ddl-v6` extends structured `CREATE TABLE` columns with generated-expression and identity semantics.

Generated columns use an explicit AST payload:

```js
const generated = sql.capabilityModel.transpileSql(
  'postgresql',
  'mysql',
  `CREATE TABLE totals (
     price DECIMAL(10,2),
     qty INTEGER,
     total DECIMAL(12,2)
       GENERATED ALWAYS AS (price * qty) STORED
   )`
);

console.log(generated.scope); // ddl-v6
```

The compiler tracks `integrity.generatedColumns` plus `integrity.generatedStored` or `integrity.generatedVirtual`. Generated expressions reuse the expression AST and cannot contain parameters, windows, subqueries or wildcards. The released grammar requires explicit `STORED` or `VIRTUAL` and treats the generated clause as the final column clause for this scope.

PostgreSQL and MySQL stored generated columns are part of the qualified common subset. SQLite generated-column capabilities are runtime/version dependent and therefore require a successful target qualification before certification. PostgreSQL virtual generated columns require PostgreSQL 18+ source and target runtime evidence.

SQL-standard identity is intentionally modeled separately from superficially similar vendor mechanisms:

```sql
id BIGINT GENERATED ALWAYS AS IDENTITY
id BIGINT GENERATED BY DEFAULT AS IDENTITY
```

The corresponding atomic capabilities are `integrity.identity`, `integrity.identityAlways`, and `integrity.identityByDefault`. The released ddl-v6 renderer treats these as PostgreSQL semantics. NuBloxSQL does **not** silently lower them to MySQL `AUTO_INCREMENT` or SQLite `INTEGER PRIMARY KEY`/ROWID semantics because allocation, override, sequence and lifecycle behavior differ.

`ddl-v6` does not yet model identity sequence options, MySQL `AUTO_INCREMENT` as its own semantic node, SQLite ROWID/AUTOINCREMENT semantics, generated-column index restrictions, or vendor-specific generated expression restrictions beyond the qualified subset.

### Foreign-key semantics (`ddl-v7`)

`ddl-v7` extends foreign-key references and named `ALTER TABLE ... ADD CONSTRAINT ... FOREIGN KEY` with structured `ON DELETE` / `ON UPDATE` actions, `MATCH` mode, `DEFERRABLE` / `NOT DEFERRABLE`, and `INITIALLY DEFERRED` / `INITIALLY IMMEDIATE`.

Atomic capabilities include `schema.tableAlter.addForeignKey`, the `integrity.onDelete*` / `integrity.onUpdate*` action families, `integrity.matchSimple|Full|Partial`, `integrity.deferrableForeignKeys`, `integrity.notDeferrableForeignKeys`, and initial-mode capabilities.

PostgreSQL supports the released deferrability semantics. MySQL action support is modeled separately and does not pretend deferred enforcement exists. SQLite foreign-key behavior remains runtime-qualified because enforcement depends on runtime configuration. Unsupported `MATCH`, `SET DEFAULT`, deferrability, and timing differences fail closed rather than being rewritten optimistically.

NuBloxSQL treats MySQL `NO ACTION` timing differences explicitly during cross-dialect planning and does not certify them as lossless PostgreSQL semantics where behavior can differ.

### Advanced index semantics (`ddl-v8`)

`ddl-v8` adds structured index keys and keeps vendor index families explicit:

- PostgreSQL and SQLite expression indexes use `schema.expressionIndex`;
- MySQL functional key parts use `schema.functionalIndex`;
- PostgreSQL `INCLUDE (...)` uses `schema.coveringIndex`;
- PostgreSQL built-in `USING btree|hash|gist|spgist|gin|brin` uses `schema.indexAccessMethod`.

Expression keys are first-class AST nodes rather than raw SQL fragments. Bind parameters, subqueries, windows and wildcards remain invalid inside released index expressions.

NuBloxSQL deliberately does not certify PostgreSQL/SQLite expression indexes as losslessly identical to MySQL functional key parts. Cross-family expression-index transpilation fails closed until a specific semantic strategy is selected. SQLite expression-index availability remains version-qualified from SQLite 3.9.0.

### Index key options (`ddl-v9`)

`ddl-v9` extends each structured index key with optional `direction`, `collation`, `operatorClass`, and `nulls` fields.

- `ASC` / `DESC` is qualified across PostgreSQL, MySQL and SQLite.
- key-level `COLLATE` is qualified for PostgreSQL and SQLite only.
- `NULLS FIRST` / `NULLS LAST` and operator-class identity are PostgreSQL-only.
- collation identity is deliberately engine-local: NuBloxSQL does not translate a collation name across dialects merely because the same text exists on both systems.

```js
const index = sql.capabilityModel.transpileSql(
  'postgresql',
  'postgresql',
  'CREATE INDEX ledger_code_idx ON ledger (code COLLATE "C" text_pattern_ops DESC NULLS LAST)'
);

console.log(index.scope); // ddl-v9
```

The atomic capabilities are `schema.indexKeyOrder`, `schema.indexKeyCollation`, `schema.indexNullsOrder`, and the existing `schema.operatorClass` capability.

### CREATE TABLE AS (`ddl-v10`)

`ddl-v10` adds first-class `CreateTableAsStatement` support for PostgreSQL, MySQL and SQLite:

```sql
CREATE TABLE IF NOT EXISTS ledger_snapshot AS
SELECT id, amount FROM ledger WHERE amount >= 0
```

The query body is the existing qualified query AST, so CTE, set-operation, expression and window capabilities remain visible in capability analysis. The released subset rejects bind parameters in CTAS queries.

Although all three Tier-1 engines support CTAS syntax, NuBloxSQL does **not** certify automatic cross-dialect CTAS transpilation. Result-column type/affinity derivation, names and physical table semantics are engine-specific, so `transpileSql()` requires the same source and target dialect until an explicit result-schema/type-normalisation strategy exists.

The atomic engine capability is `statements.createTableAs`; `IF NOT EXISTS` also requires `syntax.existence.createTableIfNotExists`.

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

Release qualification installs the packed npm artifact into clean JavaScript and strict TypeScript consumers. Dedicated `dml-v2`, `dml-v3`, `dml-v4`, `dml-v5`, `dml-v6`, `dml-v7`, `dml-v8`, `dml-v9`, `dml-v10`, `ddl-v1`, `ddl-v2`, `ddl-v3`, `ddl-v4`, `ddl-v5`, `ddl-v6`, `ddl-v7`, `ddl-v8`, `ddl-v9` and `ddl-v10` gates verify their released semantic surfaces.

### Identity, autoincrement and sequence options (`ddl-v11`)

`ddl-v11` makes allocation semantics explicit instead of collapsing them into a generic identity flag:

- PostgreSQL `GENERATED ALWAYS/BY DEFAULT AS IDENTITY (...)` can carry structured start/increment/min/max/cache/cycle options;
- PostgreSQL `CREATE SEQUENCE` supports the same structured option family;
- MySQL `AUTO_INCREMENT` is represented as a MySQL-specific semantic node;
- SQLite `INTEGER PRIMARY KEY AUTOINCREMENT` is represented as a SQLite ROWID-allocation semantic node.

These families are **not** automatically translated across dialects. Same-engine parsing/compilation is qualified; cross-family lowering requires an explicit future transformation strategy.


### Ordered PostgreSQL MERGE actions (`dml-v8`)

`dml-v8` expands PostgreSQL MERGE from the earlier one-matched/one-not-matched shape into an ordered `clauses[]` AST. Each clause records its match family, optional `AND` predicate, and one of UPDATE, DELETE, INSERT, or DO NOTHING. Clause order is preserved because PostgreSQL executes the first reachable matching action.

The released subset targets semantics shared across PostgreSQL 15–18: multiple `WHEN MATCHED` / `WHEN NOT MATCHED` clauses, action predicates and `DO NOTHING`. Unreachable same-family clauses after an unconditional clause are rejected. PostgreSQL 17+ `BY SOURCE` / `BY TARGET` and MERGE `RETURNING` remain separately versioned future capabilities rather than being accepted implicitly.


### PostgreSQL 17+ MERGE extensions (`dml-v9`)

`dml-v9` adds the PostgreSQL 17+ match families `WHEN NOT MATCHED BY SOURCE` and explicit `WHEN NOT MATCHED BY TARGET`, plus statement-level `MERGE ... RETURNING`. These capabilities are modeled as runtime-version-dependent from PostgreSQL 17. A `dml-v9` transpilation therefore requires source and target qualification; PostgreSQL 15/16 are rejected, while qualified PostgreSQL 17/18 can render and execute the statement.

The AST keeps `not-matched`, `not-matched-by-target`, and `not-matched-by-source` distinct while treating unqualified NOT MATCHED and BY TARGET as one reachability family. `RETURNING WITH (OLD/NEW AS ...)` output aliases remain outside the released subset.


### PostgreSQL MERGE query sources (`dml-v10`)

`dml-v10` upgrades MERGE `USING` from a table identifier to PostgreSQL's parenthesized `source_query` form. The source is represented with the existing `DerivedTable`/query AST, so joins, filters, expressions, CTEs and bind parameters reuse the qualified SELECT compiler. The released form requires an alias for a query source and deliberately rejects invented direct `USING a JOIN b ...` syntax; joins belong inside the parenthesized query.

Rich sources compose with `dml-v8` action chains and `dml-v9` versioned match/RETURNING features. When a rich source is combined with PostgreSQL 17+ capabilities, the statement remains `dml-v10` while its capability plan still enforces the underlying runtime-version gates.


## Product coverage model v2

`productCoverage` is the standalone NuBloxSQL planning and release-coverage API. It is deliberately separate from the SQL capability ontology: the ontology describes SQL capabilities and engine semantics, while product coverage describes NuBloxSQL subsystem maturity.

```js
const report = sql.productCoverage.report();
const gaps = sql.productCoverage.gaps();
const sqlServerParity = sql.productCoverage.area('dialect.sqlserver-parity');
```

Each area records its product pillar, overall status, per-stage maturity, per-dialect maturity, evidence files and the next known gap. `PRODUCT_COVERAGE_SCHEMA_VERSION` is currently `2`. The machine-readable release snapshot is `docs/releases/product-coverage-v2.json`.


## Database structure tree

`structureTree()` turns deep metadata into an immutable hierarchy suitable for object explorers, schema inspection, structure export, diagrams and later comparison/migration tooling.

```js
const tree = await db.structureTree({ schema: 'public' });

for (const database of tree.databases) {
  for (const schema of database.children) {
    for (const object of schema.children) {
      console.log(object.kind, object.name);
    }
  }
}
```

The hierarchy is database → schema → table/view/foreign-table → columns/indexes/foreign keys/constraints. `buildStructureTree(snapshot)` can build the same model from an existing portable metadata snapshot without opening a connection. `STRUCTURE_TREE_SCHEMA_VERSION` is currently `2`. Every node also carries a deterministic `id` from the canonical database-object identity scheme.


## Object identity and dependency graph

NuBloxSQL assigns deterministic IDs to database objects so the same logical object can be correlated across structure trees, dependency graphs and future schema snapshots.

```js
const id = sql.objectId(
  'table',
  { database: 'app', schema: 'public', name: 'orders' },
  { dialect: 'postgresql' }
);
```

`dependencyGraph()` builds an immutable graph from deep portable metadata. Edges are directed from the dependent object to the object it requires. Released relations include `contained-by`, `defined-on`, `uses-column`, `references`, and `references-column`.

```js
const graph = await db.dependencyGraph({ schema: 'public' });
const affected = sql.graphDependents(graph, id);
const analysis = sql.impactAnalysis(graph, id);
```

Graph construction is order-independent: catalog row ordering does not change node identities or dependency edges. The current graph derives structural, index/constraint-column and foreign-key dependencies; richer view/routine/trigger/native dependency evidence remains future scope.


## Canonical type semantics

`TYPE_SEMANTICS_SCHEMA_VERSION === 1` defines the released canonical type model. NuBloxSQL classifies native types into conservative families and makes target mapping quality explicit rather than silently coercing unlike semantics.

```js
const source = sql.canonicalType('postgresql', 'numeric(26,6)');
const target = sql.nativeTypeMapping('sqlserver', source);
const compatibility = sql.typeCompatibility('postgresql', 'mysql', 'uuid');
```

Mapping decisions are `native-equivalent`, `lossless-map`, `lossy-map`, `application-convention`, `runtime-qualified`, or `unsupported`. `canonicalTypeFromPortableSpec()` bridges existing portable typed binds into the same semantic vocabulary, and `annotateTypes()` projects canonical type descriptors over a portable metadata snapshot without changing portable metadata vocabulary v1.


## Canonical schema snapshots

`SCHEMA_SNAPSHOT_SCHEMA_VERSION === 1` defines the released normalized schema model. The snapshot combines portable metadata, stable object identity, canonical type semantics and dependency edges into one immutable representation.

```js
const snapshot = await db.schemaSnapshot({ schema: 'public', deep: true });
const fingerprint = sql.schemaFingerprint(snapshot);
```

Each object exposes both its engine-qualified `id` and a dialect-neutral `logicalKey`. `semanticHash` ignores source-dialect type spelling so equivalent canonical schemas can compare equal across engines; `sourceHash` also includes source dialect and native type names. Use `schemasEquivalent()` for semantic comparison and `sourceSchemasEquivalent()` for source-representation comparison.


## Canonical schema diff

`SCHEMA_DIFF_SCHEMA_VERSION === 1` compares canonical snapshots (or portable metadata inputs) using dialect-neutral logical keys. It emits added, removed and modified objects; modified objects contain explicit property deltas.

```js
const diff = sql.diffSchemas(before, after);
const changed = sql.schemaDiffChanged(diff);
const highestRisk = sql.schemaDiffHighestSafety(diff);
```

Safety classes are `safe`, `dependency-sensitive`, `manual-review`, `potentially-lossy`, and `destructive`. Classification is deliberately conservative: removals are destructive, narrowing type changes are potentially lossy, nullable→not-null requires review, and key/constraint/foreign-key changes are dependency-sensitive. Rename inference and migration DDL generation are not part of schema diff v1.


## Migration planner

`MIGRATION_PLAN_SCHEMA_VERSION === 1` transforms a canonical schema diff into an ordered migration plan.

```js
const diff = sql.diffSchemas(before, after);
const plan = sql.planMigration(diff, { targetDialect: 'postgresql' });
```

Each step includes `safety`, `execution`, `sql`, `preconditions`, rollback metadata, target dialect and logical object identity. `migrationAutomaticSteps()` and `migrationManualSteps()` split a plan by execution mode. A plan is `executable: true` only when every step has automatic SQL; this does not override destructive or potentially-lossy safety classifications.


## Migration execution engine

`MIGRATION_EXECUTION_SCHEMA_VERSION === 1` executes a migration plan through a NuBloxSQL client.

```js
const result = await db.executeMigration(plan, {
  approval: 'risky',
  approve: async ({ step }) => step.safety !== 'destructive',
  onCheckpoint: async checkpoint => saveCheckpoint(checkpoint)
});
```

Execution supports `dryRun`, approval modes, resumable checkpoints, optional compensating rollback (`failurePolicy: 'compensate'`), opt-in single-transaction execution where the plan allows it, operation timeout/cancellation options, lifecycle hooks, immutable audit records, and semantic-hash post-verification against an expected schema snapshot. Manual steps block execution before any SQL runs unless a `manualHandler` is supplied.


## Migration execution engine

`MIGRATION_EXECUTION_SCHEMA_VERSION === 1` executes a migration plan through a NuBloxSQL client.

```js
const result = await db.executeMigration(plan, {
  approval: 'risky',
  approve: async ({ step }) => step.safety !== 'destructive',
  onCheckpoint: async checkpoint => saveCheckpoint(checkpoint)
});
```

Execution supports dry-run, approval modes, resumable checkpoints, optional compensating rollback (`failurePolicy: 'compensate'`), opt-in single-transaction execution where the plan allows it, operation timeout/cancellation options, lifecycle hooks, immutable audit records, and semantic-hash post-verification against an expected schema snapshot. Manual steps block execution before any SQL runs unless a `manualHandler` is supplied.


## Database server discovery and bootstrap prerequisites

`DATABASE_SERVER_DISCOVERY_SCHEMA_VERSION === 1` exposes normalized server/instance identity and visible database/catalog inventory for PostgreSQL, MySQL, SQLite and SQL Server while retaining native evidence.

```js
const discovery = await db.discoverServer();
```

Use `assessDatabaseBootstrapPrerequisites()` or `client.assessBootstrapPrerequisites()` with an immutable bootstrap plan to combine server discovery with plan requirements before execution.

```js
const plan = db.planBootstrap({ database: 'app', schemas: ['app'] });
const prerequisites = await db.assessBootstrapPrerequisites(plan);
```

Prerequisite status is `ready`, `attention` or `blocked`. NuBloxSQL reports administrative privilege requirements as an explicit attention boundary rather than claiming portable privilege certainty where the engines expose materially different security models.


## Database configuration discovery

`DATABASE_CONFIGURATION_DISCOVERY_SCHEMA_VERSION === 1` defines the first administration-configuration contract.

```js
const report = await db.discoverConfiguration();
const workMem = sql.findDatabaseConfiguration(report, 'work_mem');
```

Each setting exposes a normalized `name`, `value`, `scope`, `apply` mode, mutability, restart requirement, source/description where available, and the complete source row under `native`.

Apply modes are:

```text
immediate
reload
restart
new-session
immutable
unknown
```

NuBloxSQL preserves uncertainty rather than inventing cross-engine equivalence. PostgreSQL `pg_settings` and SQL Server `sys.configurations` provide rich change semantics; MySQL global-variable discovery currently reports mutability/apply semantics as unknown where the discovery source cannot prove them; SQLite exposes a curated read-only PRAGMA configuration view because SQLite has no server configuration catalog.


## Database configuration change planning

`DATABASE_CONFIGURATION_PLAN_SCHEMA_VERSION === 1` defines immutable configuration change plans built from a configuration discovery report.

```js
const discovered = await db.discoverConfiguration();

const plan = db.planConfiguration(discovered, {
  changes: [
    { name: 'work_mem', value: '8192' }
  ]
});
```

Plans contain a SHA-256 `planHash`, safety-classified automatic/manual/satisfied steps, native SQL where NuBloxSQL has sufficient evidence, and explicit privilege/reload/restart/reconnect/transaction-boundary requirements.

`configurationAutomaticSteps(plan)` and `configurationManualSteps(plan)` provide filtered plan views.

Current planner behaviour is deliberately conservative:

- PostgreSQL uses `ALTER SYSTEM`, followed by `pg_reload_conf()` or a manual restart boundary according to discovered context.
- SQL Server uses `sys.sp_configure` plus `RECONFIGURE`, validates numeric bounds from `sys.configurations`, and preserves restart boundaries for non-dynamic options.
- SQLite renders direct PRAGMA assignments only for discovery entries whose lifecycle is classified as immediate; lifecycle-sensitive PRAGMAs remain manual.
- MySQL changes remain manual until variable-specific dynamic/persistible evidence is available.

Planning does not execute any change.


## Database configuration execution

`DATABASE_CONFIGURATION_EXECUTION_SCHEMA_VERSION === 1` controls execution of immutable configuration plans.

```js
const discovered = await db.discoverConfiguration();
const plan = db.planConfiguration(discovered, {
  changes: [{ name: 'work_mem', value: '8192' }]
});

const inspection = await db.inspectConfigurationPlan(plan);

const result = await db.executeConfiguration(plan, {
  approvedPlanHash: plan.planHash
});
```

Execution performs a fresh preflight discovery and refuses to mutate when the current setting has drifted from the value captured by the plan. Non-dry-run execution requires the exact `approvedPlanHash` by default.

Automatic and manual steps are followed by dialect-aware verification. PostgreSQL can verify `ALTER SYSTEM` persistence through `pg_file_settings`; SQL Server distinguishes configured and effective values so restart-bound changes are not falsely rejected; SQLite is rediscovered after safe PRAGMA changes. Restart/new-session boundaries require `openVerificationClient` for a definitive success result. Without fresh verification, the result is `pending-verification`, never falsely `succeeded`.

Database-service restarts remain manual lifecycle boundaries.
