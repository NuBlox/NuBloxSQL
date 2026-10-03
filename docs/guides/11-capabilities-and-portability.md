# Capabilities and SQL portability

NuBloxSQL does not claim that SQL dialects are identical. The capability system exists so applications, migration tooling and the compiler can ask what an engine supports, under what conditions it is available, and what NuBloxSQL itself can safely parse, represent, validate, render or rewrite.

## Simple capability checks

At runtime:

```js
if (db.supports('preparedStatements')) {
  // feature is advertised by this selected adapter
}
```

At package level:

```js
const { supports } = require('nubloxsql');
console.log(supports('postgresql', 'serverSideCursors'));
```

Use capability checks instead of guessing from dialect names where practical.

## Capability report

```js
const report = db.capabilityReport();
console.log(report.dialect);
console.log(report.capabilities);
console.log(report.runtime);
```

`capabilityReport()` is the static/platform report. `await db.discoverCapabilities()` can enrich the report with connected server/runtime evidence.

## Tier-1 capability model

The detailed legacy model currently covers PostgreSQL, MySQL and SQLite:

```js
const { capabilityModel } = require('nubloxsql');

const pg = capabilityModel.dialect('postgresql');
const feature = capabilityModel.status('postgresql', 'statements.select');
const supported = capabilityModel.supports('mysql', 'statements.select');
```

The legacy support vocabulary distinguishes `native`, `equivalent`, `emulated`, `partial`, `runtime-dependent`, `unsupported`, `unknown` and `not-applicable` states. These APIs remain supported for compatibility, migration analysis and the existing rewrite planner.

## Executable capability ontology

The versioned ontology is available as either `capabilityOntology` or `capabilityModel.ontology`:

```js
const { capabilityOntology } = require('nubloxsql');

console.log(capabilityOntology.schemaVersion); // 1
console.log(capabilityOntology.ids().length);
```

The ontology is generated from the exhaustive Tier-1 profiles and gives every modeled feature a stable atomic ID. Representative IDs include:

```text
queries.joins.inner
queries.cte.recursive
queries.setOperators.union
queries.windows.rows
queries.windows.groups
expressions.caseExpression
expressions.cast
functions.windowFunctions
schema.materializedView
security.rowLevelSecurity
transactions.xaTransactions
```

### Definitions and relationships

A definition describes the capability itself, not one database's support for it:

```js
const definition = capabilityOntology.definition('queries.windows.rows');

console.log(definition.id);
console.log(definition.family);
console.log(definition.kind);
console.log(definition.portability);
console.log(definition.relationships.requires);
```

Relationships are explicit. Recursive-CTE `SEARCH` requires recursive CTE support; `UNION ALL`, `INTERSECT ALL` and `EXCEPT ALL` require their corresponding base set operator; named windows, frame units and window functions require the base window capability.

### Engine observations

An observation answers what a particular engine profile says about a capability:

```js
const observation = capabilityOntology.observation(
  'postgresql',
  'queries.windows.groups'
);

console.log(observation.support);
console.log(observation.availability);
console.log(observation.maturity);
console.log(observation.evidence.documentation);
```

Engine support is deliberately separated from availability and maturity. `support` is one of `native`, `partial`, `emulated`, `unsupported`, `unknown` or `not-applicable`. Availability can be unconditional or version-, edition-, deployment-, engine-, connector-, extension-, component- or configuration-dependent. Maturity is `stable`, `preview`, `experimental`, `deprecated` or `removed`.

### Resolve concrete runtime conditions

```js
const before = capabilityOntology.resolve(
  'sqlite',
  'queries.joins.right',
  { version: '3.38.5' }
);

const after = capabilityOntology.resolve(
  'sqlite',
  'queries.joins.right',
  { version: '3.39.0' }
);

console.log(before.available); // false
console.log(after.available);  // true
```

If NuBloxSQL lacks enough evidence to resolve a conditional capability, `available` remains `null`; it is not converted into an optimistic `true`.

For connected Tier-1 clients use runtime qualification:

```js
const qualified = await capabilityModel.qualifyClient(db);
console.log(qualified.version);
console.log(qualified.entries);
```

This is particularly important for SQLite capabilities that depend on the host `node:sqlite` runtime, including the qualified window-function surface.

## NuBlox implementation coverage

Database support and NuBlox compiler support are different facts.

```js
const coverage = capabilityOntology.implementation('queries.windows.rows');
console.log(coverage.scope);       // select-query-v4
console.log(coverage.stages);
console.log(coverage.qualified);   // true
```

The implementation record has independent stages for parser, AST, validator, renderer, rewrite/lowering and runtime. Each stage is `implemented`, `partial`, `unsupported` or `not-applicable`.

The compiler scopes are additive:

- `select-foundation-v1` — SELECT, joins, grouping, ordering and pagination;
- `select-query-v2` — ordinary/recursive CTE declarations, scalar/`EXISTS`/`IN` subqueries, correlated-subquery detection and derived tables;
- `select-query-v3` — `UNION`, `UNION ALL`, `INTERSECT`, `INTERSECT ALL`, `EXCEPT` and `EXCEPT ALL`, including compound queries inside CTEs, subqueries and derived tables;
- `select-query-v4` — searched/simple `CASE`, structured `CAST`, PostgreSQL `::` normalization, richer comparison predicates, window functions, named windows and window frames.

A scope reports NuBlox compiler coverage, not universal target support. For example, MySQL's profile marks `GROUPS` window frames unsupported, so a PostgreSQL query that requires `GROUPS` is blocked when targeting MySQL. SQLite window support is runtime-dependent, so transpilation should use a live qualification report when window capabilities are involved.

## Rewrite planning

```js
const plan = capabilityModel.planRewrite(
  'postgresql',
  'mysql',
  ['statements.select', 'queries.windows.rows']
);

if (!plan.safeToProceed) {
  throw new Error('migration requires review');
}
```

A rewrite decision can be `preserve`, `rewrite`, `emulate`, `qualify` or `reject`. Respect `blocked`, `requiresQualification`, `requiresTransformation` and `safeToProceed` rather than checking only whether generated SQL exists.

## AST/compiler examples

### CASE and CAST

```js
const ast = capabilityModel.parseSql(
  'postgresql',
  `SELECT
     CASE
       WHEN amount BETWEEN $1 AND $2
       THEN amount::DECIMAL(12,2)
       ELSE 0
     END AS band
   FROM ledger`
);

const analysis = capabilityModel.analyzeAst(ast);
console.log(analysis.scope); // select-query-v4

const compiled = capabilityModel.compileAst('mysql', ast);
console.log(compiled.sql);
```

NuBloxSQL represents the type name and numeric modifiers as structured AST data. PostgreSQL's `::` syntax is normalized to the common cast node and rendered as `CAST(...)` for portability.

A successful cast compilation proves the grammar and target capability path, not perfect equivalence of vendor coercion semantics. Precision, overflow, collation and implicit-conversion behavior remain engine semantics and should be qualified where they are material to the application.

### Windows

```js
const source = `
  SELECT
    account_id,
    sum(amount) OVER balance_window AS running_balance
  FROM ledger
  WINDOW balance_window AS (
    PARTITION BY account_id
    ORDER BY posted_at
    ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
  )
`;

const parsed = capabilityModel.parseSql('postgresql', source);
const windowAnalysis = capabilityModel.analyzeAst(parsed);
console.log(windowAnalysis.scope); // select-query-v4
```

The AST models:

- inline and named `OVER` clauses;
- `PARTITION BY`;
- window `ORDER BY`;
- `ROWS`, `RANGE` and `GROUPS` frames;
- `UNBOUNDED PRECEDING/FOLLOWING`, `CURRENT ROW`, and expression offsets;
- `BETWEEN ... AND ...` frames;
- `EXCLUDE CURRENT ROW`, `GROUP`, `TIES` and `NO OTHERS`;
- named `WINDOW` definitions and references.

Structural validation rejects duplicate/unresolved window names and impossible frame boundaries such as starting with `UNBOUNDED FOLLOWING`.

For a runtime-dependent target, qualify first:

```js
const targetQualification = await capabilityModel.qualifyClient(sqliteClient);

const result = capabilityModel.transpileSql(
  'postgresql',
  'sqlite',
  source,
  { targetQualification }
);

console.log(result.certified);
console.log(result.sql);
```

## Set-operation semantics

NuBloxSQL parses a compound query according to the **source dialect's precedence rules** and stores that semantic tree in the AST. PostgreSQL and MySQL bind `INTERSECT` more tightly than `UNION`/`EXCEPT`; SQLite compound SELECTs group left-to-right. Rendering uses explicit grouping where required to preserve the AST.

`ALL` is capability-specific. PostgreSQL and the modeled MySQL profile support `INTERSECT ALL` and `EXCEPT ALL`; SQLite does not. A target lacking the requested quantifier is blocked rather than degraded to DISTINCT semantics.

## Compare and inspect profiles

```js
const pg = capabilityOntology.profile('postgresql');
console.log(pg.summary);

const queryCapabilities = capabilityOntology.inventory({
  dialect: 'postgresql',
  kind: 'semantic'
});

const comparison = capabilityModel.compare(
  'queries.windows.groups',
  ['postgresql', 'mysql', 'sqlite']
);
```

A comparison is only as determinate as its evidence. `unknown` and runtime-dependent states are intentionally not converted into optimistic yes/no claims.

## Portability strategy

Keep business/application code on the unified client where semantics genuinely align. Isolate native-dialect features behind small interfaces. Use engine observations for database truth, implementation coverage for NuBlox compiler truth, runtime qualification for deployed-version truth, and conformance tests for release truth.

Do not assume unsupported constructs are silently translated. A blocked or unqualified transformation remains a blocker until the relevant capability/compiler surface explicitly supports it.
