# @nublox/postgresql

Native PostgreSQL driver for NuBloxSQL. It implements PostgreSQL connectivity directly over the frontend/backend protocol and does not depend on `pg` or another PostgreSQL client library.

## Release candidate surface

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

The `0.2.0-rc.1` surface includes:

- native TCP connection lifecycle
- PostgreSQL SSLRequest negotiation with `disable`, `prefer` and `require` policies
- StartupMessage and protocol 3.0/3.2 primitives
- cleartext password authentication
- MD5 password authentication for compatibility
- SCRAM-SHA-256 challenge/response authentication with server-signature verification
- ParameterStatus and BackendKeyData capture
- ReadyForQuery transaction state tracking
- simple-query protocol
- RowDescription, DataRow, CommandComplete and EmptyQueryResponse decoding
- typed text decoding for booleans, common integer/float/numeric OIDs and JSON/JSONB
- structured PostgreSQL errors/notices
- configurable backend message-size limits
- connection and query timeout/AbortSignal hooks
- TypeScript declarations
- live PostgreSQL 18 CI

## Dialect services

```js
const postgresql = require('@nublox/postgresql');

postgresql.services.quoteIdentifier('order'); // "order"
postgresql.services.placeholder(1);            // $1
postgresql.descriptor.supports('schemas');     // true
```

## Protocol layer

Low-level protocol primitives remain available for protocol tooling and advanced consumers:

```js
const { protocol } = require('@nublox/postgresql');

const sslRequest = protocol.encodeSSLRequest();
const startup = protocol.encodeStartupMessage({ user: 'app', database: 'appdb' });
const query = protocol.encodeQuery('SELECT 1');
const parser = new protocol.BackendMessageParser();
```

## RC boundaries

This release candidate intentionally does not claim complete PostgreSQL feature coverage yet. Extended-query protocol (`Parse`/`Bind`/`Execute`), prepared statements, binary result formats, cancellation requests, pooling, COPY, notifications and replication are subsequent milestones.
