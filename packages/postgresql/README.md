# @nublox/postgresql

Native PostgreSQL driver for NuBloxSQL. It implements PostgreSQL connectivity directly over the frontend/backend protocol and does not depend on `pg` or another PostgreSQL client library.

## Status

`@nublox/postgresql@1.0.0` is the stable PostgreSQL adapter for NuBloxSQL v1.

## Connection and query

```js
const { createConnection } = require('@nublox/postgresql');

const connection = createConnection({
  host: '127.0.0.1',
  port: 5432,
  user: 'app',
  password: process.env.PGPASSWORD,
  database: 'appdb',
  ssl: 'prefer'
});

await connection.connect();
const result = await connection.query('SELECT 1::int4 AS answer');
console.log(result.rows[0].answer); // 1
await connection.end();
```

## Native prepared statements

Prepared statements use PostgreSQL's extended-query protocol directly. Statements are named server-side resources and can be executed repeatedly before being explicitly closed.

```js
const statement = await connection.prepare('SELECT $1::int4 AS id, $2::text AS name');
const first = await statement.execute([1, 'alpha']);
const second = await statement.execute([2, 'beta']);
await statement.close();
```

For one-shot parameterized execution:

```js
const result = await connection.execute(
  'SELECT $1::int4 AS id, $2::boolean AS active',
  [42, true]
);
```

## Server-side portal cursors

Portal cursors use PostgreSQL's native Bind/Execute portal lifecycle and support bounded batches and async iteration.

```js
const statement = await connection.prepare('SELECT generate_series(1, 1000) AS id');
const cursor = statement.openCursor([], { batchSize: 100 });

for await (const row of cursor) {
  // consume rows without buffering the full result set
}

await cursor.close();
await statement.close();
```

## Pooling and transactions

```js
const pool = require('@nublox/postgresql').createPool({
  user: 'app',
  password: process.env.PGPASSWORD,
  database: 'appdb',
  connectionLimit: 10
});

await pool.withTransaction(async (connection) => {
  await connection.execute('INSERT INTO audit_log(message) VALUES ($1)', ['created']);
});

await pool.end();
```

## Lossless text type policy

NuBloxSQL does not silently coerce values where JavaScript cannot preserve PostgreSQL semantics exactly.

| PostgreSQL type | JavaScript value |
| --- | --- |
| `bool` | `boolean` |
| `int2`, `int4`, `oid` | `number` |
| `int8` | `bigint` |
| `float4`, `float8` | `number` including `NaN` and infinities |
| `numeric` / `decimal` | `string` to preserve arbitrary precision |
| `bytea` | `Buffer` |
| `json`, `jsonb` | parsed JavaScript value |
| `timestamptz` | `Date` when finite |
| `date`, `time`, `timetz`, `timestamp`, `interval` | `string` |
| `uuid` | `string` |
| unknown/custom text OIDs | `string` |

`timestamp without time zone` deliberately remains a string so the driver never invents a timezone. PostgreSQL `numeric` deliberately remains a string because converting arbitrary precision values to IEEE-754 `Number` can silently lose data. Applications that need decimal arithmetic can choose their own numeric representation without the driver imposing a third-party decimal dependency.

## Stable v1 production surface

- native TCP connection lifecycle
- PostgreSQL SSLRequest negotiation with `disable`, `prefer` and `require` policies
- StartupMessage and protocol 3.0/3.2 primitives
- cleartext and MD5 compatibility authentication
- SCRAM-SHA-256 challenge/response authentication with server-signature verification
- ParameterStatus and BackendKeyData capture
- ReadyForQuery transaction state tracking
- simple-query protocol
- extended-query Parse/Bind/Describe/Execute/Close/Sync protocol
- named prepared statements and convenience parameterized execution
- PostgreSQL CancelRequest cancellation
- bounded connection pooling and reset-on-release hygiene
- transactions and savepoints
- server-side portals/cursors with bounded batch fetching and async iteration
- bounded rows/result bytes/row bytes with fail-closed connection handling
- deterministic lossless text type decoding
- structured PostgreSQL errors/notices
- configurable backend message-size limits
- connection and operation timeout/AbortSignal hooks
- TypeScript declarations

## Dialect services

```js
const postgresql = require('@nublox/postgresql');

postgresql.services.quoteIdentifier('order'); // "order"
postgresql.services.placeholder(1);            // $1
postgresql.descriptor.supports('schemas');     // true
```

Capability flags describe implemented driver behavior, not merely PostgreSQL server features.

## Supported v1 server majors

The stable v1 target matrix is PostgreSQL 15, 16, 17 and 18. Every supported major is exercised with native runtime integration, authentication/TLS failure-path tests, resource-limit recovery and deterministic type-policy tests. Production performance and forced-GC resource evidence is captured on the configured matrix endpoints.

Custom extensions, arrays, ranges and enums remain first-class PostgreSQL semantics; unsupported/custom text OIDs are returned losslessly as strings rather than guessed into JavaScript types.

## Dependency boundary

The package declares no npm runtime, optional, peer, or development dependencies. Production implementation uses Node.js built-ins and NuBlox-authored source only.

## Licence

Proprietary. Copyright (c) 2026 Stephen J T Spittal. See `LICENSE`.
