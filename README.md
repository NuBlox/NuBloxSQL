# NuBloxSQL

NuBloxSQL is a modern MySQL client for Node.js focused on protocol correctness, production resilience, observability and low-friction migration from established MySQL driver APIs.

The package supports CommonJS and native ESM, callback and Promise APIs, modern MySQL authentication, server-side prepared statements, typed binary parameters, bounded prepared-statement caching, named placeholders, transaction orchestration, pool health metrics, deterministic pool warm-up, async iteration and zlib/zstd connection compression.

## Table of Contents

- [Install](#install)
- [Quick Start](#quick-start)
- [Module Systems](#module-systems)
- [Connection Options](#connection-options)
  - [Compression](#compression)
  - [Modern Authentication](#modern-authentication)
- [Queries](#queries)
- [Prepared Statements](#prepared-statements)
  - [Typed Parameters](#typed-parameters)
  - [Named Placeholders](#named-placeholders)
- [Transactions](#transactions)
- [Pooling](#pooling)
- [Streaming](#streaming)
- [Observability](#observability)
- [Compatibility](#compatibility)
- [Testing](#testing)
- [Security](#security)
- [Licence and Provenance](#licence-and-provenance)

## Install

NuBloxSQL requires Node.js 22 or later.

```bash
npm install @nublox/mysql
```

## Quick Start

Promise API:

```js
const mysql = require('@nublox/mysql/promise');

const pool = mysql.createPool({
  host: '127.0.0.1',
  user: 'app',
  password: process.env.DB_PASSWORD,
  database: 'app'
});

const [rows] = await pool.execute(
  'SELECT id, email FROM users WHERE id = ?',
  [42]
);

await pool.end();
```

Callback API:

```js
const mysql = require('@nublox/mysql');

const connection = mysql.createConnection({
  host: '127.0.0.1',
  user: 'app',
  password: 'secret',
  database: 'app'
});

connection.query('SELECT 1 AS value', function (error, rows) {
  if (error) throw error;
  console.log(rows[0].value);
  connection.end();
});
```

## Module Systems

NuBloxSQL publishes explicit CommonJS and native ESM entrypoints for both the callback/core and Promise APIs.

ESM:

```js
import mysql, {createPool} from '@nublox/mysql/promise';

const pool = createPool(config);
const [rows] = await pool.query('SELECT 1 AS value');
```

CommonJS:

```js
const mysql = require('@nublox/mysql');
const promiseMysql = require('@nublox/mysql/promise');
```

Both module systems use the same protocol implementation and are checked for API parity in CI on Node 22, 24 and 26.

## Connection Options

NuBloxSQL accepts the familiar MySQL connection options such as `host`, `port`, `user`, `password`, `database`, `charset`, `timezone`, `ssl`, `connectTimeout`, `supportBigNumbers`, `bigNumberStrings`, `dateStrings`, `typeCast`, `localInfile` and `multipleStatements`.

NuBlox-specific and modernised options include:

- `namedPlaceholders` to enable `:name` placeholders.
- `maxPreparedStatements` to bound the per-connection prepared-statement LRU. The default is 256; set `0` to disable caching.
- `authPlugins` for pluggable authentication handlers.
- `allowPublicKeyRetrieval` and `serverPublicKey` for explicit non-TLS SHA-2 authentication policy.
- `compressionAlgorithms` for ordered connection-compression policy.
- `zstdCompressionLevel` for MySQL zstd levels 1 through 22; the default is 3.
- `minimumIdle` to define the idle target used by explicit pool warm-up.

### Compression

Compression is disabled by default. Prefer zstd with explicit zlib and uncompressed fallback:

```js
const connection = mysql.createConnection({
  ...config,
  compressionAlgorithms: ['zstd', 'zlib', 'uncompressed'],
  zstdCompressionLevel: 7
});
```

Require zstd and fail the handshake if it is unavailable:

```js
const connection = mysql.createConnection({
  ...config,
  compressionAlgorithms: ['zstd'],
  zstdCompressionLevel: 7
});
```

Require zlib instead:

```js
const connection = mysql.createConnection({
  ...config,
  compressionAlgorithms: ['zlib']
});
```

For mysql2 migration compatibility, this remains supported:

```js
const connection = mysql.createConnection({
  ...config,
  compress: true
});
```

`compress: true` maps to `['zlib', 'uncompressed']`. Use `compressionAlgorithms` when you want explicit ordered zstd/zlib/uncompressed policy.

NuBloxSQL negotiates compression only when both client policy and server capabilities permit it. The driver deliberately selects one capability rather than advertising both zlib and zstd after selection, avoiding MySQL's zlib-precedence behaviour. zstd is backed by Node's built-in runtime implementation and is feature-detected when requested; no third-party native compression dependency is required.

The compressed transport validates frame sequence numbers and declared uncompressed sizes, bounds decompression output to the declared frame size, and sends a valid uncompressed compressed-frame when compression would make a payload larger. Both zlib and zstd are exercised against live MySQL 8.4 and 9.x servers in CI.

### Modern Authentication

NuBloxSQL supports current MySQL SHA-2 authentication flows including `caching_sha2_password`, secure full authentication over TLS and explicitly controlled RSA public-key exchange for non-TLS authentication.

Server public-key retrieval is opt-in. Applications can instead provide a trusted `serverPublicKey`.

```js
const connection = mysql.createConnection({
  ...config,
  allowPublicKeyRetrieval: false,
  serverPublicKey: trustedKey
});
```

Custom authentication handlers can be supplied through `authPlugins`.

## Queries

Text queries are available through callback and Promise APIs:

```js
const [rows] = await connection.promise().query(
  'SELECT id, name FROM users WHERE status = ?',
  ['active']
);
```

Promise queries can use `AbortSignal` cancellation:

```js
const controller = new AbortController();

const pending = connection.promise().query({
  sql: 'SELECT SLEEP(10)',
  signal: controller.signal
});

controller.abort();
await pending;
```

When an operation cannot be cancelled safely in-band, NuBloxSQL terminates the affected connection rather than reporting a false cancellation success.

## Prepared Statements

`execute()` uses real MySQL server-side prepared statements and the binary protocol:

```js
const [rows] = await pool.execute(
  'SELECT id, email FROM users WHERE id = ?',
  [userId]
);
```

Repeated `execute()` calls reuse prepared statements through a bounded per-physical-connection LRU.

Manual statement lifecycle control is also available:

```js
const connection = await mysql.createConnection(config);
const statement = await connection.prepare(
  'SELECT id, email FROM users WHERE id = ?'
);

const [rows] = await statement.execute([userId]);
await statement.reset();
await statement.close();
```

Connections expose:

```js
connection.unprepare(sql);
connection.clearPreparedStatementCache();
connection.preparedStatementCacheStats();
```

NuBloxSQL automatically performs one safe reprepare attempt when MySQL reports a stale server-side statement handle.

### Typed Parameters

The `param` API makes binary-protocol intent explicit and preserves values that should not be inferred from ordinary JavaScript types.

```js
const mysql = require('@nublox/mysql/promise');

await connection.execute(
  'INSERT INTO sample(big_value, exact_value, created_at, flags, year_value) VALUES (?, ?, ?, ?, ?)',
  [
    mysql.param.uint64('18446744073709551615'),
    mysql.param.decimal('12345678901234567890.123456789'),
    mysql.param.datetime('2026-09-27 01:23:45.123456'),
    mysql.param.bit('101101'),
    mysql.param.year(2026)
  ]
);
```

Available constructors include signed and unsigned 8, 16, 32 and 64-bit integers, float, double, exact decimal, text, binary, BIT, YEAR, DATE, DATETIME, TIMESTAMP, TIME and JSON.

### Named Placeholders

Enable mysql2-compatible named placeholders on a connection:

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

The option can also be enabled or disabled per operation. Arrays continue to use positional `?` placeholders.

## Transactions

Standard transaction operations are supported, together with `withTransaction()` for Promise workflows:

```js
const result = await pool.withTransaction(async function (connection) {
  const [rows] = await connection.execute(
    'SELECT balance FROM accounts WHERE id = ? FOR UPDATE',
    [accountId]
  );

  await connection.execute(
    'UPDATE accounts SET balance = ? WHERE id = ?',
    [rows[0].balance - amount, accountId]
  );

  return rows[0];
}, {
  maxRetries: 2
});
```

Deadlock and lock-wait retry is opt-in because retrying a transaction can repeat application code.

## Pooling

Create a pool using connection limits, queue limits and an optional minimum-idle target:

```js
const pool = mysql.createPool({
  ...config,
  connectionLimit: 20,
  minimumIdle: 5,
  queueLimit: 100
});
```

`minimumIdle` does not open network connections merely by constructing the pool. Warm the pool explicitly during application startup when you are ready to handle connection errors:

```js
const result = await pool.warmup();

console.log(result);
// { target: 5, created: 5, idle: 5, total: 5, limited: false }
```

You can override the configured target for a specific warm-up:

```js
await pool.warmup(10);
```

Warm-up respects `connectionLimit`, reuses already-idle connections, and hands newly established connections to queued application demand if requests arrive while warming. It does not emit `acquire` events for connections that remain idle. Callback pools expose the same operation as `pool.warmup([count], callback)`.

Operational pool state is available without inspecting private arrays:

```js
console.log(pool.stats());
const health = await pool.healthCheck();
```

Statistics expose total, active, idle, acquiring and queued connections, configured limits, the minimum-idle target, utilisation and saturation state. Promise warm-up also publishes `nublox.mysql.pool.warmup.start`, `.end` and `.error` diagnostics events without credentials or bind values.

## Streaming

Classic row streams remain available. Promise users can also consume result rows with async iteration:

```js
for await (const row of connection.iterate(
  'SELECT * FROM large_table'
)) {
  processRow(row);
}
```

The implementation preserves stream backpressure rather than buffering an entire result set by default.

## Observability

NuBloxSQL publishes operational events through Node.js `diagnostics_channel`, including query timing and failures, pool acquisition and warm-up, transaction retry, prepared-statement cache activity and manual statement lifecycle events.

Bind values are not included in diagnostics events by default.

OpenTelemetry integration and trace-context propagation are planned in M6 on top of these zero-dependency diagnostics surfaces.

## Compatibility

mysql2 migration compatibility is tracked as executable evidence rather than a marketing assertion. See:

- `compatibility/mysql2.json` for the machine-readable capability manifest.
- `docs/compatibility/mysql2.md` for migration guidance and evidence.
- `NUBLOX-MYSQL-ROADMAP.md` for the engineering programme.
- `benchmark/` for reproducible comparison workloads.

The package intentionally keeps callback compatibility where practical while providing Promise-first, TypeScript and native ESM surfaces for modern applications.

## Testing

Run the local verification suite:

```bash
npm install --ignore-scripts
npm run verify
```

Run the complete unit suite:

```bash
npm run test:unit
```

Run live zlib transport verification against MySQL:

```bash
MYSQL_HOST=127.0.0.1 \
MYSQL_PORT=3306 \
MYSQL_USER=root \
MYSQL_PASSWORD=secret \
MYSQL_DATABASE=test \
npm run test:compression:zlib
```

Run live zstd transport verification:

```bash
MYSQL_HOST=127.0.0.1 \
MYSQL_PORT=3306 \
MYSQL_USER=root \
MYSQL_PASSWORD=secret \
MYSQL_DATABASE=test \
npm run test:compression:zstd
```

Run live pool warm-up verification:

```bash
MYSQL_HOST=127.0.0.1 \
MYSQL_PORT=3306 \
MYSQL_USER=root \
MYSQL_PASSWORD=secret \
MYSQL_DATABASE=test \
npm run test:pool-warmup
```

CI validates supported Node versions and runs live compatibility suites against MySQL 8.4 and the current MySQL 9.x line.

## Security

Security-sensitive defaults are deliberate:

- TLS certificate verification remains enabled unless explicitly disabled by the application.
- RSA server public-key retrieval is opt-in.
- Multiple statements are disabled by default.
- Compression fallback is explicit through `compressionAlgorithms`.
- Prepared-statement cache size is bounded.
- Pool warm-up is explicit rather than an implicit constructor side effect.
- Diagnostics avoid bind values by default.

Please report security issues privately through the NuBlox project security channel rather than publishing credentials or exploit details in a public issue.

## Licence and Provenance

NuBloxSQL (`@nublox/mysql`) is distributed under the Apache License, Version 2.0. Copyright 2026 Stephen J T Spittal.

The project evolved from the MIT-licensed `mysqljs/mysql` Node.js driver. The original upstream copyright and MIT permission notice for inherited portions are preserved in `THIRD_PARTY_NOTICES`.

Historical provenance does not make an upstream repository an operational dependency or authority over NuBloxSQL. Current implementation, architecture, testing, releases and roadmap are owned and maintained in this repository.

See `LICENSE`, `NOTICE`, `THIRD_PARTY_NOTICES`, `NUBLOX-MASTERED-PACKAGE.md` and the repository provenance records for details.
