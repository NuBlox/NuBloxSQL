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
| Transactions | Supported | Live begin/query/rollback checks |
| Pool query flow | Supported | Live compatibility tests |
| MySQL 8.4 / 9.x modern authentication | Supported | Live CI |
| `execute()` prepared statements | Supported | Native `COM_STMT_PREPARE` / `COM_STMT_EXECUTE` / `COM_STMT_CLOSE`, binary rows, live mysql2 parity |
| Prepared statement cache | Supported | Bounded per-connection LRU, `unprepare()`, stats, live reuse/eviction tests |
| TypeScript declarations | Partial | Present; broader mysql2 type parity remains open |
| ESM consumption | Partial | CommonJS package is importable; native ESM surface remains open |
| AbortSignal cancellation | Partial / NuBlox extension | Promise query cancellation exists; prepared-execute cancellation remains open |
| Named placeholders | Planned | M3 |
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

CI executes the live parity, prepared-execute and cache suites against the supported MySQL server matrix.
