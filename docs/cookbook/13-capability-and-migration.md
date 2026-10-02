# Capability analysis and migration

**Scope:** Tier-1 capability-model, executable capability ontology and current SQL rewrite/transpilation surfaces. These tools inform migration decisions; they do not make all vendor SQL semantically identical.

## Compare dialect capability coverage

```js
const { capabilityModel } = require('nubloxsql');

const report = capabilityModel.compareDialects(
  'postgresql',
  'mysql',
  { categories: ['queries', 'types', 'transactions'] }
);

console.log(report.summary);

for (const capability of report.capabilities) {
  if (capability.level !== 'exact') {
    console.log(capability.path, capability.level, capability.reasons);
  }
}
```

The comparison reports compatibility evidence. It is not a promise that arbitrary SQL text using a capability will automatically migrate without review.

## Inspect one capability

```js
const comparison = capabilityModel.compatibility(
  'postgresql',
  'mysql',
  'statements.select'
);

console.dir(comparison, { depth: null });
```

Use this when a migration inventory has already identified which SQL features an application depends on.

For the richer engine/implementation split, use the ontology:

```js
const { capabilityOntology } = require('nubloxsql');

const engine = capabilityOntology.observation(
  'postgresql',
  'queries.cte.recursive'
);

const nublox = capabilityOntology.implementation(
  'queries.cte.recursive'
);

console.log(engine.support);        // database capability
console.log(nublox.stages.parser); // NuBlox compiler capability
```

This prevents a migration tool from assuming NuBlox can compile a construct merely because both engines support it.

## Build a migration surface

```js
const surface = capabilityModel.migrationSurface(
  'postgresql',
  'mysql',
  'queries'
);

console.table(surface.summary);
```

A practical migration workflow can group findings into:

- exact/portable;
- equivalent but syntactically different;
- emulated;
- partial/runtime-dependent;
- unsupported;
- unknown and requiring manual qualification.

## Plan a rewrite

```js
const plan = capabilityModel.planRewrite(
  'postgresql',
  'mysql',
  [
    'statements.select',
    'queries.pagination.limit'
  ]
);

console.log(plan.summary);
console.log(plan.safeToProceed);
console.log(plan.requiresQualification);
```

A blocked plan should remain blocked until the application either changes its requirement or supplies the required runtime/semantic qualification.

## Rewrite SQL text

The current rewrite API handles known, bounded transformations.

```js
const rewritten = capabilityModel.rewriteSql(
  'postgresql',
  'mysql',
  'SELECT id, name FROM users WHERE id = $1 LIMIT 10',
  {
    capabilities: ['statements.select', 'queries.pagination.limit']
  }
);

console.log(rewritten.sql);
console.log(rewritten.rules);
console.log(rewritten.lossless);
console.log(rewritten.parameters.targetToSource);
```

Do not pass `allowBlocked` or `allowUnqualified` merely to make a migration tool continue. Those switches transfer responsibility for semantic risk to the caller.

## Current AST/transpilation scope

NuBloxSQL 1.1.x exposes a bounded SELECT-foundation AST/transpilation surface.

```js
const result = capabilityModel.transpileSql(
  'postgresql',
  'mysql',
  'SELECT id, name FROM users WHERE id = $1 ORDER BY name LIMIT 10'
);

console.log(result.scope);      // select-foundation-v1
console.log(result.sql);
console.log(result.certified);
console.log(result.lossless);
```

Treat `certified` and `lossless` as evidence about the supported transformation scope, not as a claim that every database-side behaviour is equivalent.

## Inventory application SQL before migration

A robust migration programme usually proceeds in this order:

1. inventory statements, stored logic, schema objects and engine extensions;
2. classify capabilities used by each item;
3. compare source/target engine support;
4. check NuBlox parser/AST/renderer/rewrite coverage separately;
5. separate automatic rewrites from manual changes;
6. qualify runtime-dependent behaviour against real server versions;
7. execute tests against representative data;
8. benchmark performance separately from semantic correctness;
9. retain vendor-specific SQL when it is the clearer/safer choice.

## Runtime qualification

The capability model can qualify runtime evidence where version/runtime detail affects support.

```js
const staticReport = capabilityModel.qualify('postgresql', {
  version: '18',
  source: 'deployment-inventory'
});

console.log(staticReport.summary);
```

When a connected client can supply runtime evidence, use `qualifyClient()`.

The ontology can also resolve a versioned capability directly:

```js
const rightJoin = capabilityOntology.resolve(
  'sqlite',
  'queries.joins.right',
  { version: '3.39.0' }
);

console.log(rightJoin.available);
```

## Keep migration claims narrow

A successful parse or rewrite does not prove:

- identical transaction isolation;
- identical collation/order semantics;
- identical NULL/type coercion behaviour;
- identical optimizer behaviour;
- equivalent lock/concurrency behaviour;
- identical extension/function availability.

Those must be tested at the appropriate database layer.

See [capabilities and portability](../guides/11-capabilities-and-portability.md), the [dialect guide](../guides/10-dialects.md), and [production operation](../guides/13-production-and-troubleshooting.md).
