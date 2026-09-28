# @nublox/postgresql

Native PostgreSQL driver for NuBloxSQL. It implements PostgreSQL connectivity directly over the frontend/backend protocol and does not depend on `pg` or another PostgreSQL client library.

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
const statement = await connection.prepare(
  'SELECT $1::int4 AS id, $2::text AS name'
);

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

Current extended execution uses PostgreSQL text parameter/result formats. Portal-based partial execution and binary formats are separate Gate 3 milestones.

## Current surface

- native TCP connection lifecycle
- PostgreSQL SSLRequest negotiation with `disable`, `prefer` and `require` policies
- StartupMessage and protocol 3.0/3.2 primitives
- cleartext password authentication
- MD5 password authentication for compatibility
- SCRAM-SHA-256 challenge/response authentication with server-signature verification
- ParameterStatus and BackendKeyData capture
- ReadyForQuery transaction state tracking
- simple-query protocol
- extended-query Parse/Bind/Describe/Execute/Close/Sync protocol
- named prepared statements with repeated execution and deterministic close
- convenience parameterized execution
- RowDescription, DataRow, CommandComplete and EmptyQueryResponse decoding
- typed text decoding for booleans, common integer/float/numeric OIDs and JSON/JSONB
- structured PostgreSQL errors/notices
- configurable backend message-size limits
- connection and operation timeout/AbortSignal hooks
- TypeScript declarations
- live PostgreSQL 18 CI

## Dialect services

```js
const postgresql = require('@nublox/postgresql');

postgresql.services.quoteIdentifier('order'); // "order"
postgresql.services.placeholder(1);            // $1
postgresql.descriptor.supports('schemas');     // true
```

Capability flags describe implemented driver behavior, not merely PostgreSQL server features. For example, server-side cursors and CancelRequest remain `false` until their dedicated Gate 3 implementations land.

## Protocol layer

Low-level protocol primitives remain available for protocol tooling and advanced consumers:

```js
const { protocol } = require('@nublox/postgresql');

const sslRequest = protocol.encodeSSLRequest();
const startup = protocol.encodeStartupMessage({ user: 'app', database: 'appdb' });
const parse = protocol.encodeParse('statement1', 'SELECT $1::int4', [23]);
const bind = protocol.encodeBind({ statement: 'statement1', parameters: ['42'] });
const execute = protocol.encodeExecute('', 0);
const sync = protocol.encodeSync();
const parser = new protocol.BackendMessageParser();
```

## Gate 3 boundaries

NuBloxSQL does not claim complete PostgreSQL v1 coverage yet. CancelRequest cancellation, bounded pooling, transaction helpers, portal streaming/server-side cursors, broader type decoding, TLS/authentication failure-path hardening, and performance/resource-limit evidence remain Gate 3 work.
