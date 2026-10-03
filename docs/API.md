# Public API

NuBloxSQL exposes one package entry point:

```js
const sql = require('nubloxsql');
```

For detailed, task-oriented usage see the [NuBloxSQL User Guides](guides/README.md).

## Primary entry points

- `createClient()` — create the unified client for a configured dialect.
- `createConnection()` — create a native dialect connection.
- `createPool()` — create a native pool where the dialect supports pooling.
- `sql` — tagged SQL, identifiers, named parameters and portable typed values.
- `introspect()` — one-shot metadata/schema introspection.
- `capabilityReport()` — static platform capability report.
- `transactionPolicy()` — portable transaction-policy description.
- `capabilityModel` — Tier-1 SQL compatibility, rewrite and compiler/transpilation surfaces.
- `capabilityOntology` — versioned atomic SQL capability definitions, engine observations and NuBlox implementation coverage.

## Capability ontology

`capabilityOntology` (`SQL_CAPABILITY_ONTOLOGY_SCHEMA_VERSION === 1`) projects the exhaustive Tier-1 feature inventory into a formal registry without breaking the legacy capability API.

Every capability has a stable ID and definition. Engine observations keep separate axes for:

- support: `native`, `partial`, `emulated`, `unsupported`, `unknown` or `not-applicable`;
- availability: unconditional, version-, edition-, deployment-, engine-, connector-, extension-, component- or configuration-dependent;
- maturity: stable, preview, experimental, deprecated or removed;
- evidence: source documentation and legacy classification retained from the dialect profile.

NuBlox implementation coverage is separate from engine support and reports parser, AST, validator, renderer, rewrite and runtime stages. This prevents a database feature from being treated as compiler support merely because the target engine implements it.

```js
const { capabilityOntology } = require('nubloxsql');

const definition = capabilityOntology.definition('queries.cte.recursive');
const engine = capabilityOntology.observation('postgresql', 'queries.cte.recursive');
const nublox = capabilityOntology.implementation('queries.cte.recursive');
const resolved = capabilityOntology.resolve(
  'sqlite',
  'queries.joins.right',
  { version: '3.39.0' }
);
```

`profile(dialect)` returns the complete engine inventory. `inventory({ dialect, family, kind })` supports tooling and filtered capability browsers. `validate()` checks referential and state integrity of the generated ontology.

The original `capabilityModel.status()`, `compare()`, compatibility, runtime qualification, rewrite and compiler APIs remain supported. The ontology is an additive control-plane layer above them.

## SQL AST and transpilation

`capabilityModel.parseSql()`, `analyzeAst()`, `compileAst()` and `transpileSql()` expose the released Tier-1 compiler surface for PostgreSQL, MySQL and SQLite.

Compiler scopes are additive:

- `select-foundation-v1` — SELECT, joins, grouping, ordering and pagination;
- `select-query-v2` — ordinary/recursive CTE declarations, scalar/`EXISTS`/`IN` subqueries, detectable correlated subqueries and derived tables;
- `select-query-v3` — compound queries using `UNION`, `UNION ALL`, `INTERSECT`, `INTERSECT ALL`, `EXCEPT` and `EXCEPT ALL` where the target engine supports the requested capability;
- `select-query-v4` — searched/simple `CASE`, `CAST`, PostgreSQL `::` normalization, `BETWEEN`/`NOT BETWEEN`, `NOT IN`, `NOT LIKE`, window functions, named windows and window-frame specifications;
- `dml-v1` — `INSERT ... VALUES`, multi-row inserts, `INSERT ... SELECT`, `UPDATE ... SET ... WHERE`, `DELETE FROM ... WHERE`, and capability-gated `RETURNING`.

Wave 2 set-operation support includes nested compound queries, explicit grouping, CTE bodies and derived tables containing compound queries, top-level `ORDER BY`/`LIMIT`/`OFFSET`, and parameter mapping across operands.

Wave 3 models window semantics explicitly: `OVER`, `PARTITION BY`, window `ORDER BY`, `ROWS`/`RANGE`/`GROUPS`, frame bounds, `BETWEEN ... AND ...`, `EXCLUDE`, and named `WINDOW` definitions. The target capability profile remains authoritative: for example, MySQL rejects `GROUPS` frames through the capability plan rather than emitting unsupported SQL, while SQLite window use requires runtime qualification because its profile is host-runtime dependent.

### DML compiler (`dml-v1`)

Wave 4 introduces first-class mutation ASTs: `InsertStatement`, `UpdateStatement`, `DeleteStatement` and `Assignment`. DML expressions reuse the released expression/query compiler, so CASE/CAST, predicates, parameters and `INSERT ... SELECT` query sources retain the same capability analysis and target rendering rules.

```js
const mutation = sql.capabilityModel.transpileSql(
  'postgresql',
  'sqlite',
  `UPDATE ledger
   SET amount = CASE WHEN amount < $1 THEN $1 ELSE amount END
   WHERE id = $2`
);

console.log(mutation.scope); // dml-v1
console.log(mutation.sql);
console.log(mutation.targetToSource);
```

`RETURNING` is never assumed to be universally portable. PostgreSQL exposes it natively. MySQL is rejected as an unsupported target rather than silently dropping returned rows. SQLite is runtime-dependent and therefore requires a successful target qualification before a `RETURNING` statement can be certified:

```js
const runtime = await sql.capabilityModel.qualifyClient(db);

const deletion = sql.capabilityModel.transpileSql(
  'postgresql',
  'sqlite',
  'DELETE FROM ledger WHERE id = $1 RETURNING id',
  { targetQualification: runtime }
);
```

The `dml-v1` boundary is intentionally precise. It does **not** yet claim `DEFAULT VALUES`, UPSERT/`ON CONFLICT`, `ON DUPLICATE KEY UPDATE`, `MERGE`, `UPDATE ... FROM`, `DELETE ... USING`, data-modifying CTEs, DML target aliases or vendor-specific DML modifiers. Those remain separate capability/compiler waves rather than being accepted without qualified semantics.

```js
const parsed = sql.capabilityModel.parseSql(
  'postgresql',
  `SELECT
     CASE WHEN amount BETWEEN $1 AND $2
          THEN amount::DECIMAL(12,2)
          ELSE 0
     END AS band,
     sum(amount) OVER w AS running
   FROM ledger
   WINDOW w AS (
     PARTITION BY tenant_id
     ORDER BY id
     ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
   )`
);

const analysis = sql.capabilityModel.analyzeAst(parsed);
const compiled = sql.capabilityModel.compileAst('mysql', parsed);
```

PostgreSQL `expression::type` is represented as a structured cast and renders portably as `CAST(expression AS type)`. Type names and numeric modifiers are AST data rather than arbitrary SQL text. A successful syntax/capability compilation does **not** assert that every vendor's coercion, collation, precision or overflow semantics are identical; applications that depend on those native semantics must qualify them separately.

Set-operation parsing preserves **source-dialect semantics**, not merely source text. PostgreSQL and MySQL give `INTERSECT` tighter precedence than `UNION`/`EXCEPT`; SQLite compound SELECTs group left-to-right. NuBloxSQL records the resulting tree in the AST and renders explicit grouping where required so cross-dialect transpilation preserves that tree.

Capability gating remains authoritative. SQLite supports `UNION ALL` but not `INTERSECT ALL` or `EXCEPT ALL`; those targets are rejected rather than silently changing duplicate semantics. CTE validation rejects duplicate names, forward references and self-reference without `WITH RECURSIVE`. Named-window validation rejects duplicate or unresolved window references and invalid frame bounds.

Advanced recursive CTE clauses such as `SEARCH`/`CYCLE`, CTE materialization hints and later statement families remain separately capability-gated.

## Query diagnostics

Unified Tier-1 clients expose `client.diagnose(statement, options)` for PostgreSQL, MySQL and SQLite.

```js
const report = await db.diagnose(
  sql`SELECT id, name FROM users WHERE id = ${42}`,
  { analyze: false }
);

console.log(report.summary);
console.log(report.native);
```

The versioned report (`QUERY_DIAGNOSTICS_SCHEMA_VERSION === 1`) provides a deliberately small common summary: plan node count/depth, estimated and actual rows, estimated cost, planning time and execution time where the engine supplies semantically compatible evidence. Unsupported values remain `null` rather than being invented.

`report.native` retains the complete engine-native diagnostics payload. SQLite planner warnings are also exposed through the portable `warnings` array. Passing `analyze: true` uses native EXPLAIN ANALYZE semantics on PostgreSQL and MySQL; this executes the target statement. SQLite does not expose an EXPLAIN ANALYZE equivalent through this contract. SQL Server is not yet part of the qualified portable diagnostics surface and returns an explicit unsupported error.

Engine-specific diagnostic options remain available through the options object, including PostgreSQL EXPLAIN options, MySQL `allowMutation`, and SQLite `includeOpcodes`/statement-metadata options.

## Metadata

Metadata snapshots retain the native-rich database, schema, table, column, index, foreign-key and constraint evidence supplied by each dialect.

Snapshots also expose `snapshot.portable`, an immutable **portable metadata vocabulary v1**. It normalizes common object kinds, nullability, identity/auto-increment, generated columns, index key parts, referential actions and common constraint types while retaining native payloads. Engine-specific metadata remains authoritative where semantics cannot be represented portably.

## Public classes and contracts

The public surface also includes `Client`, `ClientRowStream`, `MetadataCatalog`, `NuBloxSqlError`, `Observer`, `TypeRegistry`, dialect adapters and SQL Core.

Client operations cover queries, execution, prepared statements, streaming, transactions, savepoints, operation control, query diagnostics, type codecs, metadata and observability. Native diagnostic information is retained when NuBloxSQL supplies a portable representation.

## Dialects

Canonical runtime dialect names are `mysql`, `postgresql`, `sqlite` and `sqlserver`. The current exhaustive ontology observations and AST/transpilation control plane are generated from the Tier-1 PostgreSQL, MySQL and SQLite capability profiles; additional dialect profiles can be added without changing the ontology schema.

## Exact release contract

The exact exported JavaScript surface, package files, version and Node.js floor are machine-defined in `docs/releases/public-api-v1.json`.

The TypeScript package entry point is `types/root.d.ts`; query/compiler declarations are in `types/public.d.ts`, DML statement declarations in `types/dml.d.ts`, portable metadata in `types/portable-metadata.d.ts`, portable query diagnostics in `types/diagnostics.d.ts`, and the SQL capability ontology in `types/capability-ontology.d.ts`.

Release qualification checks both JavaScript and strict TypeScript consumer installation from the packed npm artifact.
