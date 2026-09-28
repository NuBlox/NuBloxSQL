# @nublox/postgresql

Native PostgreSQL dialect and wire-protocol implementation for NuBloxSQL.

The package currently provides the PostgreSQL dialect descriptor plus the first native protocol layer. It has no dependency on `pg` or another PostgreSQL client library.

## Dialect surface

```js
const postgresql = require('@nublox/postgresql');

postgresql.services.quoteIdentifier('order'); // "order"
postgresql.services.placeholder(1);            // $1
postgresql.descriptor.supports('schemas');     // true
```

## Wire-protocol foundation

```js
const { protocol } = require('@nublox/postgresql');

const sslRequest = protocol.encodeSSLRequest();
const startup = protocol.encodeStartupMessage({
  user: 'app',
  database: 'appdb',
  application_name: 'NuBloxSQL'
});

const parser = new protocol.BackendMessageParser();
const messages = parser.push(networkChunk);
```

Implemented protocol primitives:

- PostgreSQL protocol 3.0 and 3.2 constants
- `SSLRequest` encoding
- `StartupMessage` encoding with required-user validation
- chunk-safe backend frame parsing with configurable message-size limits
- authentication request decoding, including MD5 and SASL negotiation messages
- `ParameterStatus`
- `BackendKeyData`
- `ReadyForQuery`
- structured `ErrorResponse` and `NoticeResponse` fields
- forward-compatible preservation of unknown backend messages

This is intentionally not yet a complete connection implementation. TCP/TLS state management, SCRAM proof generation, password messages, connection lifecycle, query execution, pooling and replication remain subsequent implementation waves.
