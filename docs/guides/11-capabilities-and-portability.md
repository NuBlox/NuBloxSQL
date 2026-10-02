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

The ontology is generated from the exhaustive Tier-1 profiles and gives every modeled feature a stable atomic ID. Existing IDs such as these remain valid:

```text
queries.joins.inner
queries.joins.lateral
queries.cte.recursive
queries.cte.search
queries.setOperators.union
queries.setOperators.intersectAll
schema.materializedView
types.json
security.rowLevelSecurity
transactions.xaTransactions
```

### Definitions

A definition describes the capability itself, not one database's support for it:

```js
const definition = capabilityOntology.definition('queries.cte.search');

console.log(definition.id);
console.log(definition.family);
console.log(definition.kind);
console.log(definition.portability);
console.log(definition.relationships.requires);
```

Definitions classify capabilities as syntax, semantic, datatype, object, constraint, security, transaction, physical, operational, programmability, function, operator or extension capabilities.

Relationships are explicit. For example, recursive-CTE `SEARCH` requires recursive CTE support; `UNION ALL`, `INTERSECT ALL` and `EXCEPT ALL` require their corresponding base set operator; window-frame variants require the underlying window-function capability.

### Engine observations

An observation answers what a particular engine profile says about the capability:

```js
const observation = capabilityOntology.observation(
  'postgresql',
  'queries.cte.recursive'
);

console.log(observation.support);
console.log(observation.availability);
console.log(observation.maturity);
console.log(observation.evidence.documentation);
```

Engine support is deliberately separated from availability and maturity.

`support` is one of:

- `native`;
- `partial`;
- `emulated`;
- `unsupported`;
- `unknown`;
- `not-applicable`.

`availability.kind` can be:

- `unconditional`;
- `version-dependent`;
- `edition-dependent`;
- `deployment-dependent`;
- `engine-dependent`;
- `connector-dependent`;
- `extension-dependent`;
- `component-dependent`;
- `configuration-dependent`.

`maturity` is one of `stable`, `preview`, `experimental`, `deprecated` or `removed`.

This separation prevents concepts such as “native but only from version X”, “native but extension-dependent”, and “native preview” from being collapsed into one boolean.

### Resolve against a concrete version

When an observation is version-dependent, resolve it against the actual engine version:

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

### NuBlox implementation coverage

Database support and NuBlox compiler support are different facts.

```js
const coverage = capabilityOntology.implementation('queries.setOperators.union');
console.log(coverage.scope);       // select-query-v3
console.log(coverage.stages);
console.log(coverage.qualified);   // true
```

The implementation record has independent stages for parser, AST, validator, renderer, rewrite/lowering and runtime. Each stage is `implemented`, `partial`, `unsupported` or `not-applicable`.

The compiler currently has three additive SELECT/query scopes:

- `select-foundation-v1` — the original SELECT, join, grouping, ordering and pagination foundation;
- `select-query-v2` — ordinary/recursive CTE declarations, scalar/`EXISTS`/`IN` subqueries, correlated-subquery detection and derived tables;
- `select-query-v3` — `UNION`, `UNION ALL`, `INTERSECT`, `INTERSECT ALL`, `EXCEPT` and `EXCEPT ALL`, including compound queries inside CTEs, subqueries and derived tables.

A scope reports NuBlox compiler coverage, not universal database support. The target engine's capability observation still governs whether a particular operator is legal. For example, SQLite supports `UNION ALL` but does not support `INTERSECT ALL` or `EXCEPT ALL`; those targets are rejected rather than silently changing duplicate semantics.

`select-query-v3` does **not** imply that all SQL query grammar is implemented. Recursive `SEARCH`/`CYCLE`, CTE materialization hints, window syntax, advanced expressions and later statement families remain separately capability-gated until their compiler waves land.

### Full profiles and filtered inventory

```js
const pg = capabilityOntology.profile('postgresql');
console.log(pg.summary);

const queryCapabilities = capabilityOntology.inventory({
  dialect: 'postgresql',
  kind: 'semantic'
});
```

`profile()` is suitable for capability browsers and reports. `inventory()` can filter by capability family or kind and optionally attach one dialect's observation.

The registry can self-check its referential and state integrity:

```js
console.log(capabilityOntology.validate());
```

## Compare a capability

The existing compatibility model remains available:

```js
const comparison = capabilityModel.compare(
  'statements.select',
  ['postgresql', 'mysql', 'sqlite']
);

console.log(comparison.portable);
console.log(comparison.dialects);
```

A comparison is only as determinate as its evidence. `unknown` and runtime-dependent states are intentionally not converted into optimistic yes/no claims.

## Compare dialects

```js
const report = capabilityModel.compareDialects('postgresql', 'mysql');
console.log(report.summary);
```

For a particular category:

```js
const matrix = capabilityModel.compareCategory('transactions');
const migration = capabilityModel.migrationSurface(
  'postgresql',
  'mysql',
  'transactions'
);
```

Use this data for migration planning, compatibility tooling and test selection. Do not treat a capability summary as proof that arbitrary SQL text is portable.

## Runtime qualification

```js
const qualified = await capabilityModel.qualifyClient(db);
console.log(qualified.version);
console.log(qualified.entries);
```

Runtime qualification resolves features whose answer depends on the actual engine/runtime version. The ontology complements this by making conditional availability a first-class part of the capability record.

## Rewrite planning

```js
const plan = capabilityModel.planRewrite(
  'postgresql',
  'mysql',
  ['statements.select', 'queries.pagination.limit']
);

if (!plan.safeToProceed) {
  throw new Error('migration requires review');
}
```

A rewrite decision can be `preserve`, `rewrite`, `emulate`, `qualify` or `reject`. Respect `blocked`, `requiresQualification`, `requiresTransformation` and `safeToProceed` rather than checking only whether generated SQL exists.

## SQL rewrite

```js
const result = capabilityModel.rewriteSql(
  'postgresql',
  'mysql',
  'SELECT id FROM users LIMIT $1'
);

console.log(result.sql);
console.log(result.changed);
console.log(result.lossless);
```

The result retains parameter mapping evidence (`targetToSource`) so callers can preserve binding order.

## AST/compiler scope

The released AST/transpilation surface models the SELECT foundation, nested-query constructs and compound set queries. Formal AST nodes cover CTEs, subquery expressions, `EXISTS`, derived tables and `SetOperationStatement`.

```js
const ast = capabilityModel.parseSql(
  'postgresql',
  `WITH combined AS (
     SELECT id FROM active_users
     UNION ALL
     SELECT id FROM archived_users
   )
   SELECT id FROM combined`
);

const analysis = capabilityModel.analyzeAst(ast);
console.log(analysis.scope); // select-query-v3
console.log(analysis.capabilities);

const compiled = capabilityModel.compileAst('mysql', ast);
console.log(compiled.sql);
```

### Set-operation semantics

NuBloxSQL parses a compound query according to the **source dialect's precedence rules** and stores that semantic tree in the AST. It does not assume that identical SQL text has identical grouping on every engine.

PostgreSQL and MySQL bind `INTERSECT` more tightly than `UNION` and `EXCEPT`. SQLite compound SELECTs group left-to-right. During transpilation NuBloxSQL renders explicit grouping where the target's implicit precedence would otherwise change the AST.

```js
const result = capabilityModel.transpileSql(
  'postgresql',
  'sqlite',
  'SELECT 1 AS n UNION SELECT 2 INTERSECT SELECT 2 ORDER BY n'
);

console.log(result.scope);      // select-query-v3
console.log(result.certified);  // true when all target capabilities are supported
console.log(result.sql);
```

Top-level `ORDER BY`, `LIMIT` and `OFFSET` bind to the complete compound query. Compound queries can also appear in CTE bodies, derived tables and subqueries. Parameter-marker mapping is preserved across all operands.

`ALL` is capability-specific. PostgreSQL and the modeled MySQL profile support `INTERSECT ALL` and `EXCEPT ALL`; SQLite does not. A target lacking the requested quantifier is blocked by the capability planner instead of being degraded to DISTINCT semantics.

The parser continues to validate CTE structure before rendering. It rejects duplicate CTE names, illegal forward references and self-reference without `WITH RECURSIVE`. Derived tables require aliases. Capability analysis walks nested and compound queries recursively.

Do not assume unsupported constructs are silently translated. A blocked or unqualified transformation remains a blocker until the relevant capability/compiler surface explicitly supports it.

## Portability strategy

Keep business/application code on the unified client where semantics genuinely align. Isolate native-dialect features behind small interfaces. Use engine observations for database truth, implementation coverage for NuBlox compiler truth, runtime qualification for deployed-version truth, and conformance tests for release truth.
