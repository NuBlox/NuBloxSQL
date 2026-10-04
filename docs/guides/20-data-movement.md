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
- cross-dialect execution through the normal NuBloxSQL client API.

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

## Current boundary

The public pipeline is intentionally independent of vendor-specific transfer mechanisms. PostgreSQL COPY, MySQL LOCAL INFILE and other engine-native acceleration can be added beneath this contract without changing application code.

Durable checkpoint storage, distributed job coordination and scheduling remain responsibilities of the future generic NuBloxSQL job infrastructure.
