# MySQL service

**Scope:** MySQL-native recipe using the NuBloxSQL MySQL runtime. MySQL-specific security and bulk-ingestion controls are used deliberately.

## Pool configuration

```js
const { createPool } = require('nubloxsql');

const pool = createPool('mysql', {
  host: process.env.MYSQL_HOST,
  port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE,
  ssl: 'require',
  connectionLimit: 20,
  maxIdle: 10,
  idleTimeout: 30_000,
  acquireTimeout: 5_000
});
```

Use explicit TLS policy in production. If the server uses an authentication flow that exchanges cleartext credentials, NuBloxSQL requires explicit opt-in/secure transport rather than silently weakening the connection.

## Normal parameterized execution

```js
async function findUserByEmail(email) {
  const result = await pool.execute(
    'SELECT id, email, display_name FROM users WHERE email = ?',
    [email],
    { timeout: 5_000 }
  );

  return result.rows[0] || null;
}
```

## Transaction

```js
async function transferBalance(fromId, toId, amount) {
  return pool.withTransaction(async (connection) => {
    const debit = await connection.execute(
      'UPDATE accounts SET balance = balance - ? WHERE id = ? AND balance >= ?',
      [amount, fromId, amount]
    );

    if (Number(debit.affectedRows) !== 1) throw new Error('insufficient funds');

    await connection.execute(
      'UPDATE accounts SET balance = balance + ? WHERE id = ?',
      [amount, toId]
    );
  }, {
    isolationLevel: 'read-committed'
  });
}
```

## Secure LOCAL INFILE

LOCAL INFILE is disabled by default. Enable it only for a connection/pool that actually needs the feature.

```js
const importPool = createPool('mysql', {
  host: process.env.MYSQL_HOST,
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE,
  ssl: 'require',
  localInfile: true,
  localInfileMaxBytes: 64 * 1024 * 1024,
  connectionLimit: 2
});

async function importUsers(csvText) {
  const statement =
    "LOAD DATA LOCAL INFILE 'users-inline.csv' " +
    "INTO TABLE staging_users " +
    "FIELDS TERMINATED BY ',' " +
    "LINES TERMINATED BY '\\n' " +
    '(id, email, display_name)';

  return importPool.loadDataLocal(statement, csvText, {
    filename: 'users-inline.csv',
    maxBytes: 64 * 1024 * 1024,
    timeout: 120_000
  });
}
```

The filename requested by the server must match `options.filename`; NuBloxSQL does not treat LOCAL INFILE as unrestricted filesystem access. Prefer an in-memory/streamed source produced by your application.

## Structured diagnostics

```js
const report = await pool.diagnoseQuery(
  'SELECT id, created_at FROM orders WHERE customer_id = ? ORDER BY created_at DESC',
  [42]
);

console.log(report.summary.tables);
console.log(report.summary.accessTypes);
console.log(report.summary.estimatedRows);
```

For execution evidence, `explainAnalyze()` executes the statement and should only be used where that is safe.

## Prepared statements

For repeated work on a dedicated connection:

```js
const connection = await pool.getConnection();
try {
  const statement = await connection.prepare(
    'SELECT id, email FROM users WHERE id = ?'
  );
  try {
    console.log((await statement.execute([42])).rows);
    console.log((await statement.execute([43])).rows);
  } finally {
    await statement.close();
  }
} finally {
  await pool.releaseConnection(connection);
}
```

## Shutdown

```js
await importPool.end();
await pool.end();
```

See [connections and pooling](../guides/02-connections-and-pooling.md), the [dialect guide](../guides/10-dialects.md), and [production operation](../guides/13-production-and-troubleshooting.md).
