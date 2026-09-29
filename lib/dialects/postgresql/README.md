# PostgreSQL Runtime

## Role inside NuBloxSQL

This workspace implements the native PostgreSQL runtime used by the public `nubloxsql` facade.

Application developers should normally install and import **NuBloxSQL once** rather than install this workspace separately.

## Status

- Dialect: PostgreSQL
- Runtime version: `1.0.0`
- Status: **Stable**
- Qualified PostgreSQL: **15, 16, 17, 18**
- Qualified Node.js: **22, 24, 26**

## What it implements

- native TCP/TLS startup lifecycle;
- PostgreSQL protocol 3.x startup and execution primitives;
- cleartext, MD5 compatibility and SCRAM-SHA-256 authentication;
- simple-query and extended-query protocols;
- named prepared statements and parameterized execution;
- race-safe native CancelRequest cancellation;
- bounded pooling and release hygiene;
- transactions and savepoints;
- native portals/cursors with bounded batches;
- row/result resource limits;
- deterministic lossless text type decoding;
- structured PostgreSQL errors/notices;
- TypeScript declarations.

## How NuBloxSQL reaches it

```js
const sql = require('nubloxsql');

const db = sql.createConnection({
  dialect: 'postgresql',
  host: '127.0.0.1',
  user: 'app',
  password: process.env.DB_PASSWORD,
  database: 'app'
});
```

Advanced PostgreSQL-native access remains available from the same installation:

```js
sql.postgresql
```

## Native semantics

PostgreSQL schemas, OIDs, type decoding, portals, prepared-statement lifecycle and CancelRequest behaviour remain owned by this runtime. NuBloxSQL exposes them through one platform without flattening them into MySQL-shaped behaviour.

## Verification

```bash
npm run test:postgresql
npm run verify
```

The runtime declares no third-party npm runtime, development, optional or peer dependencies.

## Licence

Proprietary software. Copyright (c) 2026 Stephen J T Spittal. See `LICENSE`.
