# Data movement

NuBloxSQL provides a portable first-class data-movement pipeline for copying rowsets between supported database clients without coupling callers to one vendor bulk protocol.

```js
const sql = require('nubloxsql');

const source = sql.createClient({ dialect: 'postgresql', /* ... */ });
const target = sql.createClient({ dialect: 'mysql', /* ... */ });

const result = await sql.moveData(source, target, {
  source: { statement: 'SELECT id, name FROM users ORDER BY id' },
  target: {
    table: 'users',
    columns: [
      { source: 'id', target: 'id', required: true },
      { source: 'name', target: 'name', required: true }
    ]
  }
}, {
  batchSize: 500,
  onCheckpoint(checkpoint) {
    // Persist externally if durable restart recovery is required.
  }
});
```

The same operation is available from the source client as `source.moveDataTo(target, spec, options)`.

## Transfer planning

NuBloxSQL selects the target write strategy before reading source rows:

```js
const plan = sql.planDataMovement(source, target, spec);

console.log(plan.strategy);
console.log(plan.accelerated);
console.log(plan.reason);
```

The same decision is available as `source.planDataMovementTo(target, spec, options)`.

Strategy preference is explicit:

- `strategy: 'auto'` — default. Use a qualified native writer when available and fall back safely when a batch contains a value that the native text transport cannot encode losslessly.
- `strategy: 'native'` — require a qualified native writer and fail rather than fall back.
- `strategy: 'portable'` — always use the parameter-bound batched INSERT path.

Current planned target strategies are:

| Target | Strategy | Status |
| --- | --- | --- |
| PostgreSQL | `postgresql-copy-csv` | native COPY FROM STDIN acceleration when the runtime exposes `copyFrom()` |
| MySQL | `mysql-local-infile-tsv` | native LOAD DATA LOCAL INFILE acceleration only when `localInfile: true` is explicitly configured |
| SQLite | `sqlite-batched-insert` | bounded portable batched INSERT; no false native bulk-load claim |
| SQL Server | `sqlserver-batched-insert` | bounded portable batched INSERT until a qualified TDS bulk-row writer is exposed |
| Other/forced portable | `portable-batched-insert` | cross-dialect fallback |

Native acceleration remains an internal execution strategy beneath the same public movement contract.

## Contract

The v1 pipeline provides:

- deterministic source-to-target column mapping;
- safe parameter binding through the target dialect compiler;
- configurable batching;
- optional row transformation and validation;
- stop or skip handling for invalid rows;
- checkpoint callbacks;
- resumability with plan-hash validation;
- dry-run mode;
- audit records and lifecycle events;
- cross-dialect execution through the normal NuBloxSQL client API;
- preflight transfer planning with an explicit reason and fallback;
- per-batch native PostgreSQL COPY and opt-in MySQL LOCAL INFILE acceleration;
- lossless automatic fallback to parameter-bound INSERT for values not supported by native text transport.

Checkpoints represent the largest contiguous processed source prefix. A failed batch therefore never advances the resumable offset and cannot be silently skipped after restart.

## Resume

```js
const resumed = await sql.resumeDataMovement(
  source,
  target,
  spec,
  savedCheckpoint,
  { batchSize: 500 }
);
```

The source query must be deterministic for offset-based resume. Use a stable `ORDER BY` over a unique key when restart correctness matters.

## Native acceleration and checkpoints

Native writers execute one committed batch at a time. A checkpoint advances only after that batch succeeds. The native paths therefore preserve the same largest-contiguous-prefix resume guarantee as the portable path.

PostgreSQL COPY and MySQL LOCAL INFILE currently accelerate scalar text-safe values: null, strings, finite numbers, bigint, booleans and valid Date values. In `auto` mode, batches containing values outside that lossless text set (for example structured objects or binary payloads) use the portable parameter-bound fallback. In `native` mode, such a batch fails rather than silently changing representation.

MySQL LOCAL INFILE remains disabled unless the target client was created with `localInfile: true`; the planner will not implicitly weaken that security policy.

## Current boundary

SQL Server exposes lower-level TDS bulk-load packet capability, but NuBloxSQL does not yet claim native data-movement acceleration until a row encoder/writer is implemented and qualified. SQLite deliberately reports its batched INSERT strategy rather than inventing a native bulk protocol that SQLite core does not provide.

Durable checkpoint storage, distributed job coordination and scheduling remain responsibilities of the future generic NuBloxSQL job infrastructure.
