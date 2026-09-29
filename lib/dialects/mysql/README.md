# MySQL Runtime

## Role inside NuBloxSQL

This workspace implements the native MySQL runtime used by the public `nubloxsql` facade.

Application developers should normally install and import **NuBloxSQL once** rather than install this workspace separately.

## Status

- Dialect: MySQL
- Runtime version: `1.0.0`
- Status: **Stable**
- Qualified MySQL: **8.4, 9.7**
- Qualified Node.js: **22, 24, 26**

## What it implements

- native MySQL protocol framing and handshake;
- TLS negotiation;
- supported `mysql_native_password` and `caching_sha2_password` flows;
- simple query execution;
- native prepared statements and binary parameter/result handling;
- transactions and savepoints;
- bounded pooling and session reset;
- streaming with socket-level backpressure;
- row/result resource limits;
- timeout/deadline/AbortSignal control;
- deterministic MySQL/NuBloxSQL error behaviour;
- TypeScript declarations.

## How NuBloxSQL reaches it

```js
const sql = require('nubloxsql');

const db = sql.createConnection({
  dialect: 'mysql',
  host: '127.0.0.1',
  user: 'app',
  password: process.env.DB_PASSWORD,
  database: 'app'
});
```

Advanced MySQL-native access remains available from the same installation:

```js
sql.mysql
```

## Native semantics

MySQL protocol, authentication, session-state, prepared-statement and server-status behaviour remains owned by this runtime. NuBloxSQL does not pretend those semantics are universal across SQL engines.

## Verification

```bash
npm run test:mysql
npm run verify
```

The runtime declares no third-party npm runtime, development, optional or peer dependencies.

## Licence

Proprietary software. Copyright (c) 2026 Stephen J T Spittal. See `LICENSE`.
