# SQLite Runtime

## Role inside NuBloxSQL

This workspace implements the embedded SQLite runtime used by the public `nubloxsql` facade.

Application developers should normally install and import **NuBloxSQL once** rather than install this workspace separately.

## Status

- Dialect: SQLite
- Runtime version: `0.1.0`
- Status: **Development**
- Minimum Node.js: **22.16.0**

SQLite is active post-v1 development and is not part of the stable v1.0.0 support claim.

## What it implements

- in-memory and file-backed databases;
- prepared statements and parameter binding;
- `BigInt` reads for SQLite INTEGER values;
- DEFERRED, IMMEDIATE and EXCLUSIVE transactions;
- savepoints and rollback-to-savepoint;
- busy timeout;
- foreign-key enforcement enabled by default;
- optional query-only mode;
- row/result resource limits;
- database, table/view and column introspection;
- deterministic NuBloxSQL error classification;
- SQL Core capability/descriptor compatibility.

## How NuBloxSQL reaches it

```js
const sql = require('nubloxsql');

const db = sql.createConnection({
  dialect: 'sqlite',
  filename: './app.db'
});
```

Advanced SQLite-native access remains available from the same installation:

```js
sql.sqlite
```

## Native semantics

SQLite is embedded rather than client/server. Storage lifecycle, transaction modes, locking and type-affinity behaviour remain owned by this runtime. NuBloxSQL does not fabricate client/server features such as connection pooling or native query cancellation where SQLite does not provide those semantics.

## Verification

```bash
npm run test:sqlite
npm run verify
```

The runtime uses Node.js `node:sqlite` and declares no third-party npm runtime, development, optional or peer dependencies.

## Licence

Proprietary software. Copyright (c) 2026 Stephen J T Spittal. See `LICENSE`.
