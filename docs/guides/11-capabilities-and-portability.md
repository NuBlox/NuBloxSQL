# Capabilities and SQL portability

NuBloxSQL does not claim that SQL dialects are identical. The capability model exists so applications and tooling can ask what is supported, how two dialects differ and whether a transformation is safe.

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

The detailed model currently covers PostgreSQL, MySQL and SQLite:

```js
const { capabilityModel } = require('nubloxsql');

const pg = capabilityModel.dialect('postgresql');
const feature = capabilityModel.status('postgresql', 'queries.select');
const supported = capabilityModel.supports('mysql', 'queries.select');
```

The model's support vocabulary distinguishes `native`, `equivalent`, `emulated`, `partial`, `runtime-dependent`, `unsupported`, `unknown` and `not-applicable` states.

## Compare a capability

```js
const comparison = capabilityModel.compare(
  'queries.select',
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

Runtime qualification resolves features whose answer depends on the actual engine/runtime version.

## Rewrite planning

```js
const plan = capabilityModel.planRewrite(
  'postgresql',
  'mysql',
  ['queries.select', 'expressions.limit']
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

The released AST/transpilation surface is currently a **SELECT foundation**, not a complete SQL language compiler. It models identifiers, literals, parameters, wildcards, function calls, unary/binary/list/aliased expressions, table references, joins, grouping, ordering, limit and offset.

```js
const ast = capabilityModel.parseSql('postgresql', sqlText);
const analysis = capabilityModel.analyzeAst(ast);
const compiled = capabilityModel.compileAst('mysql', ast);
```

`transpileSql()` combines parse, capability analysis, rewrite planning and target compilation for the currently supported scope:

```js
const result = capabilityModel.transpileSql(
  'postgresql',
  'mysql',
  'SELECT id, name FROM users WHERE id = $1'
);

console.log(result.certified, result.lossless, result.sql);
```

Do not assume unsupported statement families are silently translated. A blocked/unsupported transformation should remain a blocker until the capability/compiler surface explicitly supports it.

## Portability strategy

Keep business/application code on the unified client where semantics genuinely align. Isolate native-dialect features behind small interfaces. Use capability evidence for conditional paths. Test each target database against the exact versions you deploy.