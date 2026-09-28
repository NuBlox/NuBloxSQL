# @nublox/mysql

NuBloxSQL's native MySQL driver, authored for the proprietary NuBloxSQL v1 line using Node.js built-ins and NuBlox-owned source only.

## Status

This package is the canonical MySQL adapter for the NuBloxSQL v1 release candidate line. It replaces the historical mysqljs-derived implementation in the current source tree.

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

## Release policy

`1.0.0-rc.*` builds are release candidates. NuBloxSQL does not declare the stable `1.0.0` release until every gate in `docs/v1/V1-RELEASE-PLAN.md` and the proprietary-IP audit is satisfied.
