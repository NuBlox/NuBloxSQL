# Diagnose query plans

**Scope:** native PostgreSQL/MySQL/SQLite diagnostics. Query-plan formats are engine-specific by design.

## PostgreSQL

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

Use `explainAnalyze()` only when executing the statement is acceptable. `ANALYZE` executes the query, so treat it differently from a plan-only inspection.

## MySQL

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

MySQL also exposes `explainAnalyze()` and `diagnoseQuery()`. Keep the returned native JSON plan because optimizer details are not fully portable.

## SQLite

SQLite diagnostics are synchronous because the native embedded connection API is synchronous.

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

Planner warnings can surface full scans, temporary B-trees and automatic indexes. They are diagnostic evidence, not proof that a query is wrong; context such as table size and workload still matters.

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

See the [dialect guide](../guides/10-dialects.md), [production guide](../guides/13-production-and-troubleshooting.md), and [capability guide](../guides/11-capabilities-and-portability.md).
