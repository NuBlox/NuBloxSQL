# Dialect guide

This guide summarises released configuration and native-depth features. The unified `Client` API is preferred for portable application code; native APIs remain available when engine semantics matter.

## PostgreSQL

Qualified Tier-1 server versions: PostgreSQL 15, 16, 17 and 18.

Typical client:

```js
const db = createClient({
  dialect: 'postgresql',
  host: '127.0.0.1',
  port: 5432,
  user: 'app',
  password: process.env.DB_PASSWORD,
  database: 'app',
  applicationName: 'orders-service',
  ssl: { mode: 'require', rejectUnauthorized: true },
  pool: { max: 20 }
});
```

Native PostgreSQL configuration includes application name, startup parameters, SSL policy, connection/cancel timeout, message/result limits and protocol version controls.

Native runtime depth includes prepared statements, portal cursors, cancellation, transactions/savepoints, COPY FROM/TO, LISTEN/NOTIFY, structured EXPLAIN/EXPLAIN ANALYZE and deep catalog introspection.

Example native diagnostic call:

```js
const report = await db.native.explainAnalyze(
  'SELECT * FROM users WHERE id = $1',
  [42],
  { buffers: true, timing: true }
);
```

Only use `db.native` methods when the client is actually PostgreSQL.

## MySQL

Qualified Tier-1 server versions: MySQL 8.4 and 9.7.

```js
const db = createClient({
  dialect: 'mysql',
  host: '127.0.0.1',
  port: 3306,
  user: 'app',
  password: process.env.DB_PASSWORD,
  database: 'app',
  ssl: { mode: 'require', rejectUnauthorized: true },
  pool: { max: 20 }
});
```

Native configuration includes packet/result limits, stream high-water mark, LOCAL INFILE policy, server public-key controls and guarded cleartext-authentication opt-in.

Native runtime depth includes prepared execution, reset/session handling, streaming, operation control, secure LOCAL INFILE, structured EXPLAIN/EXPLAIN ANALYZE, authentication-plugin qualification and deep INFORMATION_SCHEMA/Performance Schema metadata.

Cleartext authentication is guarded. Do not enable `allowCleartextAuth` unless the authentication path and transport security are understood and explicitly required.

LOCAL INFILE is disabled unless allowed by configuration/policy and should be constrained with byte limits and trusted file/source handling.

## SQLite

SQLite is Tier 1 through Node's embedded `node:sqlite` runtime and is qualified across Node.js 22/24/26.

```js
const db = createClient({
  dialect: 'sqlite',
  filename: './data/app.db',
  mode: 'readwrite-create',
  foreignKeys: true,
  productionDefaults: true,
  journalMode: 'wal',
  synchronous: 'normal',
  busyTimeout: 5_000
});
```

SQLite does not use the portable pool model.

Native configuration includes open mode, busy timeout, foreign keys, query-only/read-only policy, bigint reading, journal/synchronous/locking mode, WAL checkpoint policy, cache size and extension policy.

Native runtime depth includes backup/serialization, attached databases, integrity/foreign-key checks, maintenance, controlled extensions/functions, feature probes, EXPLAIN QUERY PLAN diagnostics, changesets, resource governance and hardened production qualification for performance, memory, concurrency and corrupt input.

For multi-process/multi-connection write workloads, understand SQLite locking and WAL semantics before treating it like a client/server database.

## SQL Server

SQL Server is Tier 2: a supported native runtime maintained outside the Tier-1 qualification gate.

```js
const db = createClient({
  dialect: 'sqlserver',
  host: '127.0.0.1',
  port: 1433,
  user: 'app',
  password: process.env.DB_PASSWORD,
  database: 'app',
  tdsVersion: '8.0',
  rejectUnauthorized: true,
  pool: { max: 20 }
});
```

Native configuration includes TDS 7.4/8.0 selection, connect/query/cancel timeouts, certificate verification, TLS versions, MARS and pool settings.

The native runtime exposes raw queries, typed parameter execution, prepared statements, streaming, cancellation, transactions/savepoints and TDS protocol facilities. `readOnly` and `deferrable` transaction options are not supported in the SQL Server portable transaction declaration.

## Choosing portable versus native APIs

Use the unified client for connection routing, parameter binding, common result shapes, prepared statements, transactions, streaming, errors, metadata and telemetry. Drop to native APIs for capabilities that are genuinely engine-specific, such as PostgreSQL COPY/LISTEN, MySQL LOCAL INFILE, SQLite maintenance/changesets or SQL Server-specific TDS controls.

Check `db.dialect` and capability evidence before entering native code paths.