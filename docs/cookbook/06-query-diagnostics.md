# Diagnose query plans

**Scope:** unified Tier-1 diagnostics first, with native PostgreSQL/MySQL/SQLite reports retained for engine-specific tuning.

## Unified client entry point

Use `client.diagnose()` when application or tooling code needs one diagnostics contract across PostgreSQL, MySQL and SQLite.

```js
const { createClient, sql } = require('nubloxsql');

async function diagnose(config) {
  const db = createClient(config);

  try {
    const report = await db.diagnose(
      sql`SELECT id, email FROM users WHERE email = ${'stephen@example.com'}`
    );

    console.log(report.dialect);
    console.log(report.mode);
    console.log(report.summary);
    console.log(report.warnings);

    // Never discarded: full engine-native evidence.
    console.dir(report.native, { depth: null });
  } finally {
    await db.close();
  }
}
```

The portable summary intentionally normalizes only concepts with defensible cross-dialect meaning. Missing evidence stays `null`.

## Runtime analysis

PostgreSQL and MySQL can execute the target statement while collecting runtime plan evidence:

```js
const report = await db.diagnose(statement, {
  analyze: true
});
```

`analyze: true` **executes the statement**. Use it only when execution and any side effects are acceptable. MySQL protects non-SELECT/TABLE statements unless `allowMutation: true` is explicitly supplied. SQLite currently returns an unsupported error for portable execution analysis because its exposed diagnostics are EXPLAIN/EXPLAIN QUERY PLAN rather than an EXPLAIN ANALYZE equivalent.

## PostgreSQL native depth

```js
const { createConnection } = require('nubloxsql');

async function diagnosePostgres(config) {
  const db = createConnection('postgresql', config);
  await db.connect();

  try {
    const report = await db.explain(
      'SELECT id, email FROM users WHERE email = $1',
      ['stephen@example.com'],
      { costs: true, buffers: true }
    );

    console.log(report.summary.rootNodeType);
    console.log(report.summary.totalCost);
    console.log(report.summary.planRows);
    console.dir(report.plan, { depth: null });
  } finally {
    await db.end();
  }
}
```

Use native `explainAnalyze()` when PostgreSQL-specific options such as buffers, WAL, timing, serialization, generic plans or version-specific EXPLAIN features matter.

## MySQL native depth

```js
const { createConnection } = require('nubloxsql');

async function diagnoseMySql(config) {
  const db = createConnection('mysql', config);
  await db.connect();

  try {
    const report = await db.explain(
      'SELECT id, email FROM users WHERE email = ?',
      ['stephen@example.com']
    );

    console.log(report.summary.tables);
    console.log(report.summary.accessTypes);
    console.log(report.summary.estimatedRows);
    console.dir(report.plan, { depth: null });
  } finally {
    await db.end();
  }
}
```

MySQL also exposes native `explainAnalyze()` and `diagnoseQuery()`. Keep the returned native JSON plan because optimizer details are not fully portable.

## SQLite native depth

SQLite native diagnostics are synchronous because the embedded connection API is synchronous.

```js
const { createConnection } = require('nubloxsql');

const db = createConnection('sqlite', {
  filename: 'app.db',
  open: false
});

db.open();
try {
  const diagnosis = db.diagnoseQuery(
    'SELECT id, email FROM users WHERE email = ?',
    ['stephen@example.com'],
    { includeOpcodes: true }
  );

  console.log(diagnosis.plan.summary);
  console.log(diagnosis.plan.warnings);
  console.log(diagnosis.explain && diagnosis.explain.opcodeCount);
} finally {
  db.close();
}
```

Through the unified client, the same SQLite warnings are copied into `report.warnings` while the complete native diagnosis remains in `report.native`.

## A repeatable tuning workflow

1. Capture the exact SQL shape and representative parameter values.
2. Record the plan before changing indexes or SQL.
3. Check row estimates, scans/searches, join order and temporary work.
4. Change one thing at a time.
5. Re-run the same diagnostic.
6. Validate runtime behaviour with representative data.
7. Keep application-level latency and resource metrics alongside plan evidence.

## Avoid plan cargo-culting

A sequential/full scan can be the correct plan for a small table or a query that needs most rows. An index can make writes more expensive. Tune against actual workload goals, not a rule that every query must use an index.

See the [public API](../API.md), [dialect guide](../guides/10-dialects.md), [production guide](../guides/13-production-and-troubleshooting.md), and [capability guide](../guides/11-capabilities-and-portability.md).
