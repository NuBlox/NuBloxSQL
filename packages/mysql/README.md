# @nublox/mysql

Native MySQL adapter for NuBloxSQL.

## Status

- Package: `@nublox/mysql`
- Version: `1.0.0`
- Status: **Stable**
- NuBloxSQL baseline: **v1.0.0**
- Node.js: **22, 24, 26**
- Qualified MySQL: **8.4, 9.7**

## Capabilities

The stable v1 surface includes:

- native MySQL protocol framing and handshake;
- TLS negotiation;
- supported `mysql_native_password` and `caching_sha2_password` authentication flows;
- simple query execution;
- native prepared statements and binary parameter/result handling;
- transactions and savepoints;
- bounded pooling with session reset before reuse;
- streaming results with socket-level backpressure;
- row/result resource limits;
- relative timeouts, adapter-native absolute deadlines and AbortSignal handling;
- deterministic NuBloxSQL client/server error model;
- TypeScript declarations.

Capability flags describe implemented adapter behaviour, not every feature available in a MySQL server.

## Quick start

```js
const mysql = require('@nublox/mysql');

const connection = mysql.createConnection({
  host: '127.0.0.1',
  user: 'app',
  password: process.env.MYSQL_PASSWORD,
  database: 'app'
});

await connection.connect();
const result = await connection.query('SELECT 1 AS ok');
await connection.end();
```

## Semantics

MySQL-specific protocol, authentication, session-state and prepared-statement behaviour remain adapter-owned. SQL Core is a portable contract vocabulary; it does not wrap or erase MySQL-native semantics.

## Dependency boundary

The package declares no third-party npm runtime, development, optional or peer dependencies. Production implementation uses Node.js built-ins and NuBlox-authored source.

## Related documentation

- `../../README.md`
- `../../docs/architecture/multi-dialect.md`
- `../../docs/v1/V1-SUPPORT-MATRIX.md`
- `../../docs/v1/V1-MIGRATION.md`

## Licence

Proprietary software. Copyright (c) 2026 Stephen J T Spittal. See `LICENSE`.
