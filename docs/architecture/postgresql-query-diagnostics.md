# PostgreSQL structured query diagnostics

NuBloxSQL exposes PostgreSQL-native `EXPLAIN` and `EXPLAIN ANALYZE` through a structured JSON contract. The implementation remains PostgreSQL-specific and does not introduce application-level query-advice policy into the shared SQL core.

## API

```js
const report = await connection.explain(
  'SELECT payload FROM users WHERE id = $1',
  [42],
  { settings: true }
);
```

For execution statistics:

```js
const report = await connection.explainAnalyze(
  'SELECT sum(amount) FROM invoice',
  [],
  {
    buffers: true,
    wal: true,
    timing: false,
    summary: true
  }
);
```

`diagnoseQuery()` is an alias of `explain()` for parity with NuBloxSQL's SQLite diagnostic vocabulary.

Pools expose the same three operations and borrow/release one ordinary pooled session per diagnostic operation.

## Returned contract

Every report uses PostgreSQL `FORMAT JSON` and returns the original PostgreSQL plan document plus conservative normalized metadata:

- `format`
- `analyzed`
- `statementExecuted`
- `plan`
- `root`
- `summary.rootNodeType`
- `summary.totalCost`
- `summary.planRows`
- `summary.actualRows`
- `summary.actualTotalTime`
- `summary.planningTime`
- `summary.executionTime`
- `summary.nodeCount`
- `summary.maxDepth`
- `summary.nodeTypes`
- `settings`
- `triggers`
- `jit`

The raw JSON plan remains authoritative. NuBloxSQL does not label a sequential scan, join type, cost, or estimate as inherently good or bad.

## Version-aware options

NuBloxSQL validates EXPLAIN features against the connected server's `server_version` parameter before sending syntax that older servers do not support:

| Option | Minimum supported PostgreSQL version |
| --- | --- |
| `GENERIC_PLAN` | 16 |
| `SERIALIZE` | 17 |
| `MEMORY` | 18 |

The common PostgreSQL 15–18 surface includes `ANALYZE`, `VERBOSE`, `COSTS`, `SETTINGS`, `BUFFERS`, `WAL`, `TIMING`, `SUMMARY`, and `FORMAT JSON`.

PostgreSQL documents `GENERIC_PLAN` as incompatible with `ANALYZE`; NuBloxSQL rejects that combination before execution. `WAL`, `TIMING`, and `SERIALIZE` are likewise validated against their execution requirements.

## Safety semantics

`explain()` defaults to plan-only operation and therefore does not execute the target statement.

`explainAnalyze()` sets `ANALYZE TRUE`. PostgreSQL actually executes the target statement in this mode. Consequently, data-modifying statements have their normal side effects unless the caller explicitly executes them inside a transaction that is later rolled back. NuBloxSQL exposes this fact through `statementExecuted: true` and does not silently wrap diagnostic statements in a transaction because doing so would alter transaction/session semantics.

Parameterized plans are executed through PostgreSQL's extended query protocol so bound values remain bound values rather than being interpolated into SQL.

## Qualification

The live PostgreSQL workflow qualifies this surface against PostgreSQL 15, 16, 17, and 18. Version-specific options are tested where supported and explicitly rejected where unavailable. Existing COPY, LISTEN/NOTIFY, cancellation, result-governance, type-fidelity, pooling, and production-evidence checks remain mandatory regression gates.

## Evidence

The implementation follows PostgreSQL's documented `EXPLAIN` command and machine-readable JSON output. PostgreSQL recommends machine-readable formats such as JSON for programmatic plan processing. `EXPLAIN ANALYZE` executes the statement, so callers must treat it as an execution operation rather than a read-only inspection command.
