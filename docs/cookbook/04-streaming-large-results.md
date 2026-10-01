# Streaming large result sets

**Scope:** portable unified-client pattern. Native runtimes may expose additional cursor/stream controls.

Use `stream()` when materializing the complete result would create unnecessary memory pressure or latency.

```js
const { createClient, sql } = require('nubloxsql');

async function exportCustomers(db, writeRow) {
  const stream = db.stream(sql`
    SELECT id, email, display_name
    FROM customers
    ORDER BY id
  `, {
    batchSize: 500,
    maxRows: 1_000_000,
    maxResultBytes: 512 * 1024 * 1024,
    maxRowBytes: 1024 * 1024
  });

  try {
    for await (const row of stream) {
      await writeRow(row);
    }
  } finally {
    await stream.close();
  }
}
```

The stream is an async iterator. Consume it with `for await...of` so backpressure is naturally tied to downstream work.

## Stop early

If the application has enough rows, close the stream explicitly.

```js
const stream = db.stream(sql`
  SELECT id, event_type, created_at
  FROM audit_log
  ORDER BY id
`);

const firstHundred = [];
try {
  for await (const row of stream) {
    firstHundred.push(row);
    if (firstHundred.length === 100) break;
  }
} finally {
  await stream.close();
}
```

## Timeout

```js
const stream = db.stream(sql`
  SELECT * FROM very_large_report
`, {
  timeout: 30_000
});
```

A timeout is a database-operation control, not a substitute for HTTP/request timeouts at the service layer.

## AbortSignal

```js
const controller = new AbortController();

const stream = db.stream(sql`
  SELECT id, payload FROM events ORDER BY id
`, {
  signal: controller.signal
});

setTimeout(() => controller.abort(), 10_000);

try {
  for await (const row of stream) {
    await processRow(row);
  }
} catch (error) {
  if (error.category !== 'cancelled') throw error;
} finally {
  await stream.close();
}
```

Cancellation support is dialect-dependent. Inspect `db.supports('queryCancellation')` or the capability report before treating cancellation as an invariant across every engine.

## Result budgets

`maxRows`, `maxResultBytes` and `maxRowBytes` are defensive boundaries. They are particularly useful when query shape or data volume is influenced by user input.

Choose limits from application SLOs and memory budgets rather than arbitrary large numbers.

## Native depth

PostgreSQL exposes native portal cursors. MySQL exposes native result streaming. SQL Server exposes TDS row streams. SQLite is embedded and iterates rows directly through its native statement/runtime integration. Use the unified stream when a common application contract matters; use the native runtime when engine-specific cursor semantics are important.

See [streaming and operation control](../guides/06-streaming-and-operation-control.md) and [production operation](../guides/13-production-and-troubleshooting.md).
