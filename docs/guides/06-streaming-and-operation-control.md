# Streaming and operation control

## Stream rows incrementally

Use `db.stream()` when you do not want to materialise the entire result set at once:

```js
const stream = db.stream(sql`
  SELECT id, created_at, payload
  FROM events
  ORDER BY id
`);

for await (const row of stream) {
  await processRow(row);
}
```

`ClientRowStream` is an async iterator. When iteration completes, NuBloxSQL closes the stream resource.

## Stop early

If you stop consuming manually, close the stream:

```js
const stream = db.stream(sql`SELECT id, payload FROM events ORDER BY id`);
try {
  const first = await stream.next();
  if (!first.done) console.log(first.value);
} finally {
  await stream.close();
}
```

A `for await` loop that exits normally through iterator return semantics also participates in deterministic cleanup, but explicit `close()` is the clearest rule when control flow is unusual.

## Stream budgets

Portable stream options include:

```js
const stream = db.stream(sql`SELECT * FROM large_table`, {
  batchSize: 500,
  highWaterMark: 1000,
  maxRows: 100_000,
  maxResultBytes: 128 * 1024 * 1024,
  maxRowBytes: 4 * 1024 * 1024
});
```

Availability and exact native mechanics differ by dialect. Result budgets protect the application even when the database would otherwise return a much larger result.

## Operation timeout

All normal client operations accept a timeout in milliseconds:

```js
const rows = await db.all(sql`SELECT id FROM work_queue`, {
  timeout: 5_000
});
```

A timeout limits operation duration; it is not a substitute for database-side statement/resource policy.

## Deadline

Use an absolute `Date` or millisecond timestamp when multiple operations must share an external deadline:

```js
const deadline = new Date(Date.now() + 10_000);

await db.query(sql`SELECT 1`, { deadline });
```

## AbortSignal

```js
const controller = new AbortController();

const promise = db.query(sql`SELECT * FROM expensive_report`, {
  signal: controller.signal
});

setTimeout(() => controller.abort(new Error('request cancelled')), 1_000);

await promise;
```

Cancellation behaviour is dialect-specific under the hood. NuBloxSQL exposes the outcome through its portable error surface where possible.

## Pool acquisition control

When a client uses a pool, an operation can control connection acquisition separately:

```js
await db.query(sql`SELECT id FROM jobs`, {
  acquire: {
    timeout: 1_000,
    signal: requestSignal
  },
  timeout: 5_000
});
```

This distinction matters under load: an acquisition timeout means no connection became available in time; an operation timeout means work on an acquired connection exceeded the operation limit.

## Native streaming

Native runtimes expose additional streaming/cursor behaviours. PostgreSQL provides portal cursors and cursor batching; MySQL exposes native result streams; SQL Server exposes async row streams; SQLite exposes native prepared iteration. Use these APIs through `db.native` or the dialect module only when you intentionally accept vendor-specific behaviour.

## Resource rule

Treat clients, pools, prepared statements, streams, cursors and native subscriptions as owned resources. Close each at the same abstraction level that created it. Resource leaks are especially harmful in pooled applications because they can exhaust connection capacity without obvious query failures.