# PostgreSQL service

**Scope:** PostgreSQL-native recipe using the NuBloxSQL PostgreSQL runtime. PostgreSQL-specific features are used deliberately.

## Pool for normal request traffic

```js
const { createPool } = require('nubloxsql');

const pool = createPool('postgresql', {
  host: process.env.PGHOST,
  port: Number(process.env.PGPORT || 5432),
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  database: process.env.PGDATABASE,
  ssl: 'require',
  connectionLimit: 20,
  maxIdle: 10,
  idleTimeout: 30_000,
  acquireTimeout: 5_000
});

async function findUserByEmail(email) {
  const result = await pool.execute(
    'SELECT id, email, display_name FROM users WHERE email = $1',
    [email],
    { timeout: 5_000 }
  );
  return result.rows[0] || null;
}
```

Use the pool for concurrent request/worker traffic. Reserve a dedicated connection when session state, notifications or cursor ownership must remain bound to one backend connection.

## Transaction

```js
async function transferBalance(fromId, toId, amount) {
  return pool.withTransaction(async (connection) => {
    const debit = await connection.execute(
      'UPDATE accounts SET balance = balance - $1 WHERE id = $2 AND balance >= $1',
      [amount, fromId]
    );

    if (Number(debit.rowCount) !== 1) throw new Error('insufficient funds');

    await connection.execute(
      'UPDATE accounts SET balance = balance + $1 WHERE id = $2',
      [amount, toId]
    );
  }, {
    isolationLevel: 'serializable'
  });
}
```

## COPY FROM STDIN

COPY is the preferred native path for high-volume ingestion.

```js
const { createConnection } = require('nubloxsql');

async function importCsv(config, chunks) {
  const db = createConnection('postgresql', config);
  await db.connect();

  try {
    return await db.copyFrom(
      'COPY staging_users (id, email, display_name) FROM STDIN WITH (FORMAT csv)',
      chunks,
      { maxBytes: 512 * 1024 * 1024, timeout: 120_000 }
    );
  } finally {
    await db.end();
  }
}
```

`chunks` may be an iterable or async iterable of strings/Buffers/Uint8Arrays. Keep a byte ceiling to prevent an unbounded producer from consuming unlimited resources.

## COPY TO STDOUT

```js
const result = await db.copyTo(
  'COPY (SELECT id, email FROM users ORDER BY id) TO STDOUT WITH (FORMAT csv)',
  { maxBytes: 512 * 1024 * 1024 }
);

await fs.promises.writeFile('users.csv', result.data);
```

For very large exports, use a sink rather than retaining the complete output buffer.

A `COPY TO` output-budget failure or sink failure retires the owning PostgreSQL connection instead of attempting to reuse a session whose COPY stream was interrupted. When `copyTo()` is invoked through a NuBloxSQL pool, the pool removes that connection and supplies a replacement for subsequent work. When using a dedicated connection directly, treat such a failed `copyTo()` as terminal for that connection and create a new one before issuing more SQL.

## LISTEN/NOTIFY

A notification subscription belongs on a dedicated connection.

```js
const connection = createConnection('postgresql', config);
await connection.connect();
await connection.listen('job_events');

connection.on('notification', (event) => {
  console.log(event.channel, event.payload);
});

await connection.notify('job_events', JSON.stringify({ jobId: 42 }));
```

Always `unlisten()`/close the owning connection during shutdown.

## Structured diagnostics

```js
const report = await pool.diagnoseQuery(
  'SELECT * FROM orders WHERE customer_id = $1 ORDER BY created_at DESC',
  [42],
  { costs: true, buffers: true }
);

console.log(report.summary);
```

Use `explainAnalyze()` only when executing the statement is safe.

## Shutdown

```js
process.once('SIGTERM', async () => {
  await pool.end();
  process.exit(0);
});
```

See [connections and pooling](../guides/02-connections-and-pooling.md), the [dialect guide](../guides/10-dialects.md), and [production operation](../guides/13-production-and-troubleshooting.md).
