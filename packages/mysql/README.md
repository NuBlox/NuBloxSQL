# @nublox/mysql

NuBloxSQL's native MySQL driver, authored for the proprietary NuBloxSQL v1 line using Node.js built-ins and NuBlox-owned source only.

## Status

`@nublox/mysql@1.0.0` is the stable canonical MySQL adapter for NuBloxSQL v1. It replaces the historical mysqljs-derived implementation in the current source/package tree.

## Supported v1 surface

- native MySQL protocol framing and handshake
- TLS negotiation
- `mysql_native_password`, `caching_sha2_password`, and supported secure authentication flows
- simple query execution
- prepared statements and binary parameter/result handling
- transactions and savepoints
- bounded pooling with session reset before reuse
- streaming results with socket-level backpressure
- row/result resource limits
- relative timeouts, absolute deadlines, and AbortSignal cancellation
- stable NuBlox client/server error model
- TypeScript declaration surface

## Dependency boundary

The package declares no npm runtime, optional, peer, or development dependencies. Production implementation uses Node.js built-ins and NuBlox-authored code only.

## Example

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

## Licence

Proprietary. Copyright (c) 2026 Stephen J T Spittal. See `LICENSE`.
