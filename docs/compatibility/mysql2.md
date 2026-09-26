# mysql2 compatibility

NuBloxSQL is being engineered as a low-friction migration path from mysql2 while adding stronger production diagnostics, cancellation and resilience features.

The compatibility reference for this document is mysql2 `3.24.4`, reviewed on 2026-09-26. The machine-readable source of truth is [`compatibility/mysql2.json`](../../compatibility/mysql2.json).

## Current capability matrix

| Capability | Status | Evidence / next milestone |
| --- | --- | --- |
| `createConnection()` | Supported | Contract + live compatibility tests |
| `createPool()` | Supported | Contract + live compatibility tests |
| `createPoolCluster()` | Supported | Contract test |
| Callback query API | Supported | mysql/mysql2-compatible core surface |
| Promise query API | Supported | Contract + live compatibility tests |
| `escape()`, `escapeId()`, `format()`, `raw()` | Supported | Contract parity checks |
| Placeholder text queries | Supported | Live compatibility tests |
| Named placeholders | Supported | Connection/query/execute opt-in, repeated names, pool flow, quoted SQL and positional fallback |
| Transactions | Supported | Live begin/query/rollback checks |
| Pool query flow | Supported | Live compatibility tests |
| MySQL 8.4 / 9.x modern authentication | Supported | Live CI |
| `execute()` prepared statements | Supported | Native `COM_STMT_PREPARE` / `COM_STMT_EXECUTE` / `COM_STMT_CLOSE`, binary rows, live mysql2 parity |
| Prepared statement cache | Supported | Bounded per-connection LRU, `unprepare()`, stats, live reuse/eviction tests |
| Manual `prepare()` statements | Supported | Callback + Promise statement lifecycle, acquired pool connections, live mysql2 parity |
| TypeScript declarations | Partial | Present; broader mysql2 type parity remains open |
| ESM consumption | Partial | CommonJS package is importable; native ESM surface remains open |
| AbortSignal cancellation | Partial / NuBlox extension | Promise query cancellation exists; prepared-execute cancellation remains open |
| Compression | Planned | M4 |
| Query attributes | Planned | M6 |
| Binary log / CDC | Planned | M7 |

A capability moves to **Supported** only when executable evidence exists in the repository.

## Migration target

For supported API areas, migration should be close to an import replacement.

mysql2:

```js
const mysql = require('mysql2/promise');
const pool = mysql.createPool(config);
const [rows] = await pool.execute(
  'SELECT * FROM users WHERE id = ?',
  [id]
);
```

NuBloxSQL:

```js
const mysql = require('@nublox/mysql/promise');
const pool = mysql.createPool(config);
const [rows] = await pool.execute(
  'SELECT * FROM users WHERE id = ?',
  [id]
);
```

NuBloxSQL `execute()` is a real prepared-statement operation. It prepares on the server, sends parameters using the MySQL binary protocol, decodes binary result rows and reuses the prepared statement from a per-connection LRU cache.

## Named placeholders

NuBloxSQL supports the mysql2 `namedPlaceholders` option for both text queries and `execute()` calls.

```js
const connection = mysql.createConnection({
  ...config,
  namedPlaceholders: true
});

const [rows] = await connection.promise().execute(
  'SELECT :left + :right AS total, :left AS repeated',
  {left: 20, right: 22}
);
```

Named placeholders are rewritten client-side to ordinary `?` placeholders because the MySQL wire protocol has no native named-parameter representation. Repeated names therefore produce repeated positional values.

The option can be enabled per operation even when it is disabled on the connection:

```js
connection.query({
  sql: 'SELECT :id AS id',
  values: {id: 42},
  namedPlaceholders: true
});
```

It can also be disabled per operation when the connection default is enabled. Passing an array continues to use ordinary positional `?` placeholders, matching mysql2 behaviour. Conversion uses the same maintained `named-placeholders` parser used by mysql2 so placeholder-looking text inside supported quoted SQL is not treated as a bind parameter.

## Manual prepared statements

Like mysql2, NuBloxSQL supports explicit connection-scoped prepared statements when an application wants to control the server-side statement lifecycle directly.

Promise API:

```js
const connection = await mysql.createConnection(config);
const statement = await connection.prepare(
  'SELECT id, email FROM users WHERE id = ?'
);

const [rows] = await statement.execute([userId]);
await statement.close();
```

Callback API:

```js
connection.prepare(
  'SELECT id, email FROM users WHERE id = ?',
  function (error, statement) {
    if (error) throw error;

    statement.execute([userId], function (executeError, rows) {
      statement.close();
      if (executeError) throw executeError;
      console.log(rows);
    });
  }
);
```

Manual statements expose `id`, `query`, parameter metadata and result-column metadata. They are intentionally separate from the automatic LRU used by `connection.execute()`, matching mysql2's lifecycle model.

NuBloxSQL additionally tracks manual statement validity locally. Closing a statement, or resetting connection identity through `changeUser()`, invalidates that statement object. A later local execute fails with `PREPARED_STATEMENT_CLOSED` instead of blindly sending a stale statement identifier to MySQL.

Lifecycle diagnostics are published on `nublox.mysql.statement.lifecycle` with action, connection ID, statement ID and SQL template. Bind values are not published.

## Prepared statement cache

NuBloxSQL accepts the mysql2-compatible `maxPreparedStatements` connection option. mysql2 currently documents a default LRU size of 16,000 statements per connection. NuBloxSQL deliberately defaults to **256 per physical connection** to keep server and client resource consumption bounded across larger pools.

```js
const pool = mysql.createPool({
  ...config,
  maxPreparedStatements: 256
});
```

Set the value to `0` when server-side prepared statement caching is undesirable, such as environments where session pinning is a concern:

```js
const pool = mysql.createPool({
  ...config,
  maxPreparedStatements: 0
});
```

Connections expose explicit cache controls:

```js
connection.unprepare('SELECT * FROM users WHERE id = ?');
connection.clearPreparedStatementCache();
console.log(connection.preparedStatementCacheStats());
```

Statistics include the configured limit, current size, hits, misses, hit rate, prepare count, evictions, invalidations and automatic reprepares.

Cache events are also published through `diagnostics_channel` on `nublox.mysql.statement.cache`. Bind values are never included in those events.

NuBloxSQL retries a prepared operation once when MySQL reports that the statement needs to be reprepared or that its server-side statement handle is no longer valid.

## NuBlox extensions already available

The migration surface is intentionally compatible where practical, but NuBloxSQL also exposes production-oriented features that do not require mysql2-compatible call shapes:

- `AbortSignal` cancellation for Promise queries;
- `withTransaction()` with opt-in deadlock and lock-wait retry;
- pool `stats()` and `healthCheck()`;
- prepared-statement cache metrics and diagnostics;
- manual prepared-statement lifecycle diagnostics and stale-handle guards;
- async-iterable result streaming through `iterate()`;
- `diagnostics_channel` query, pool, transaction and prepared-cache events;
- secure modern authentication with opt-in RSA public-key retrieval.

## Automated checks

Offline contract checks:

```bash
npm run test:compat:mysql2:contract
```

Live text-query parity:

```bash
MYSQL_HOST=127.0.0.1 \
MYSQL_PORT=3306 \
MYSQL_USER=root \
MYSQL_PASSWORD=secret \
MYSQL_DATABASE=test \
npm run test:compat:mysql2
```

Live prepared-execute parity:

```bash
MYSQL_HOST=127.0.0.1 \
MYSQL_PORT=3306 \
MYSQL_USER=root \
MYSQL_PASSWORD=secret \
MYSQL_DATABASE=test \
npm run test:compat:mysql2:execute
```

Live cache and queue-order verification:

```bash
MYSQL_HOST=127.0.0.1 \
MYSQL_PORT=3306 \
MYSQL_USER=root \
MYSQL_PASSWORD=secret \
MYSQL_DATABASE=test \
npm run test:compat:mysql2:cache
```

Live manual prepare lifecycle parity:

```bash
MYSQL_HOST=127.0.0.1 \
MYSQL_PORT=3306 \
MYSQL_USER=root \
MYSQL_PASSWORD=secret \
MYSQL_DATABASE=test \
npm run test:compat:mysql2:prepare
```

Live named-placeholder parity:

```bash
MYSQL_HOST=127.0.0.1 \
MYSQL_PORT=3306 \
MYSQL_USER=root \
MYSQL_PASSWORD=secret \
MYSQL_DATABASE=test \
npm run test:compat:mysql2:named
```

CI executes all live compatibility suites against the supported MySQL server matrix.
