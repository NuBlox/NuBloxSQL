# Connections and pooling

NuBloxSQL separates three concepts:

- `createClient()` — the normal application-facing unified API;
- `createConnection()` — a native dialect connection;
- `createPool()` — a native dialect pool where pooling is supported.

Prefer `createClient()` unless you specifically need a native dialect API.

## Configuration object

```js
const db = createClient({
  dialect: 'mysql',
  host: 'db.internal',
  port: 3306,
  user: 'app',
  password: process.env.DB_PASSWORD,
  database: 'application'
});
```

Each dialect validates its own connection options. Unknown portability should not be inferred from similarly named vendor settings.

## Connection URLs

```js
const mysql = createClient('mysql://app:secret@localhost:3306/app');
const pg = createClient('postgresql://app:secret@localhost:5432/app');
const sqlServer = createClient('sqlserver://app:secret@localhost:1433/app');
const sqlite = createClient('sqlite:./data/app.db');
```

A `URL` object is accepted as well. Object properties supplied as overrides are merged through the dialect routing layer.

Do not embed production passwords in source code. Use environment/secrets infrastructure appropriate to the deployment platform.

## Client pooling

MySQL, PostgreSQL and SQL Server can back a unified client with a pool:

```js
const db = createClient({
  dialect: 'postgresql',
  host: '127.0.0.1',
  user: 'app',
  password: process.env.DB_PASSWORD,
  database: 'app',
  pool: {
    max: 20,
    maxIdle: 10,
    idleTimeout: 30_000,
    acquireTimeout: 5_000,
    queueLimit: 100,
    resetOnRelease: true
  }
});
```

The portable pool options include `max`/`connectionLimit`, `maxIdle`, `idleTimeout`, `acquireTimeout`, `queueLimit` and `resetOnRelease`. Individual dialect pools may expose additional native controls.

SQLite is embedded and does not use the portable pool model; its typed client configuration restricts `pool` to `false`.

## Native pools and connections

Use native objects when you deliberately need engine-specific functionality:

```js
const { createPool } = require('nubloxsql');

const pool = createPool('postgresql', {
  user: 'app',
  password: process.env.DB_PASSWORD,
  database: 'app',
  connectionLimit: 10
});

try {
  const result = await pool.query('SELECT current_database()');
} finally {
  await pool.end();
}
```

Native method names and result shapes are dialect-specific. Code written directly against them is intentionally less portable.

## Acquisition control

Portable operations can carry an `acquire` option when a pool is in use:

```js
const controller = new AbortController();

const rows = await db.all(sql`SELECT id FROM jobs`, {
  acquire: {
    timeout: 2_000,
    signal: controller.signal
  },
  timeout: 10_000
});
```

Pool acquisition timeout and operation timeout are separate concerns: one limits waiting for a connection; the other limits the database operation.

## TLS

TLS is a native connection concern and differs by engine.

MySQL accepts `ssl` as a boolean, `disable`/`prefer`/`require`, or an options object containing certificate and verification controls. PostgreSQL accepts `ssl` with `disable`/`prefer`/`require` semantics and certificate options. SQL Server exposes certificate verification/TLS version settings in its native connection configuration.

Prefer certificate verification in production. Do not use `rejectUnauthorized: false` as a routine workaround for certificate problems.

## Lifecycle ownership

The code that creates a client/pool should normally own its shutdown. In services, create long-lived pools during application startup and close them during graceful shutdown rather than creating a pool per request.

```js
process.on('SIGTERM', async () => {
  await db.close();
  process.exit(0);
});
```

## Configuration diagnostics

Configuration and routing failures are exposed as NuBloxSQL public errors before or during connection establishment. Keep the original error, `category`, `code`, `dialect`, `nativeCode`, `sqlState` and `cause` when logging failures; never log passwords or private keys.