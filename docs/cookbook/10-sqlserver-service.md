# SQL Server service

**Scope:** SQL Server-native recipe using NuBloxSQL's TDS runtime. SQL Server is currently a supported Tier-2 dialect rather than part of the Tier-1 qualification gate.

## Pool configuration

```js
const { createPool } = require('nubloxsql');

const pool = createPool('sqlserver', {
  host: process.env.MSSQL_HOST,
  port: Number(process.env.MSSQL_PORT || 1433),
  user: process.env.MSSQL_USER,
  password: process.env.MSSQL_PASSWORD,
  database: process.env.MSSQL_DATABASE,
  rejectUnauthorized: true,
  connectionLimit: 20,
  maxIdle: 10,
  idleTimeout: 30_000,
  acquireTimeout: 5_000,
  queryTimeout: 15_000,
  cancelTimeout: 5_000
});
```

Use certificate validation appropriate to your deployment. Do not disable verification simply to work around an incorrectly configured server certificate.

## Query and execute

```js
async function recentOrders(customerId) {
  return pool.execute(
    `SELECT TOP (100)
       id, customer_id, created_at, status
     FROM orders
     WHERE customer_id = @p1
     ORDER BY created_at DESC`,
    [customerId],
    { timeout: 5_000 }
  );
}
```

SQL Server syntax differs from Tier-1 dialects in several areas, including pagination and some data types. Keep SQL Server-specific SQL explicit rather than pretending all syntax is portable.

## Transaction

```js
async function transferBalance(fromId, toId, amount) {
  return pool.withTransaction(async (connection) => {
    const debit = await connection.execute(
      'UPDATE accounts SET balance = balance - @p1 WHERE id = @p2 AND balance >= @p1',
      [amount, fromId]
    );

    if (Number(debit.rowCount) !== 1) throw new Error('insufficient funds');

    await connection.execute(
      'UPDATE accounts SET balance = balance + @p1 WHERE id = @p2',
      [amount, toId]
    );
  }, {
    isolationLevel: 'read-committed'
  });
}
```

`readOnly` and `deferrable` transaction options are not exposed as SQL Server transaction capabilities in the current runtime.

## Prepared work

Prepared statements belong to an acquired connection.

```js
const connection = await pool.getConnection();

try {
  const statement = connection.prepare(
    'SELECT id, email FROM users WHERE id = @p1'
  );

  try {
    const first = await statement.execute([42]);
    const second = await statement.execute([43]);
    console.log(first.rows, second.rows);
  } finally {
    await statement.close();
  }
} finally {
  await pool.releaseConnection(connection);
}
```

## Streaming

```js
const connection = await pool.getConnection();
try {
  const stream = connection.queryParametersStream(
    'SELECT id, payload FROM events WHERE id > @p1 ORDER BY id',
    [lastSeenId],
    { timeout: 30_000, highWaterMark: 64 }
  );

  try {
    for await (const row of stream) {
      await processEvent(row);
    }
  } finally {
    await stream.close();
  }
} finally {
  await pool.releaseConnection(connection);
}
```

## Error evidence

The native `SqlServerError` can retain SQL Server number/state/severity and native result evidence. The unified client additionally exposes portable error categories. Log the portable category for cross-dialect operations and retain native diagnostic fields for database-specific support work.

## Shutdown

```js
await pool.end();
```

See the [dialect guide](../guides/10-dialects.md), [streaming guide](../guides/06-streaming-and-operation-control.md), and [production guide](../guides/13-production-and-troubleshooting.md).
