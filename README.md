# NuBloxSQL

**NuBloxSQL is a single-entry, multi-dialect SQL database integration platform for Node.js.**

Install one package, import one API, select a dialect through configuration, and use the same developer contract across SQL engines.

```bash
npm install nubloxsql
```

```js
const { createClient, sql } = require('nubloxsql');

const db = createClient({
  dialect: 'postgresql',
  host: '127.0.0.1',
  user: 'app',
  password: process.env.DB_PASSWORD,
  database: 'app',
  pool: { max: 20 }
});

const user = await db.one(sql`
  SELECT id, name, email
  FROM ${sql.identifier('users')}
  WHERE id = ${42}
`);

await db.close();
```

The tagged SQL is compiled through the selected dialect. Values become native placeholders and identifiers are quoted by the dialect runtime. Application code does not need to know whether the engine uses `?`, `$1`, or another placeholder form.

## The NuBloxSQL model

```text
                    application code
                          │
                          ▼
                 createClient() + sql
                          │
                          ▼
                       NuBloxSQL
                          │
                 dialect selection
                          │
        ┌─────────────────┼─────────────────┐
        ▼                 ▼                 ▼
      MySQL           PostgreSQL          SQLite
   native runtime     native runtime    embedded runtime
```

The public platform owns:

- one installation and one import;
- dialect selection;
- portable SQL value placeholders and identifier quoting;
- a unified query/result contract;
- portable prepared statements with named bindings;
- async-iterable streaming with deterministic resource cleanup;
- a portable error taxonomy with native diagnostics retained;
- connection and pool ownership;
- transactions;
- capability discovery;
- direct access to the selected native runtime when required.

The native dialect runtimes own wire protocols, authentication, storage lifecycle, locking, database type systems, cancellation, cursor mechanics and genuinely database-specific behavior.

The governing principle is **one developer API, honest dialect semantics**.

## Supported dialects

| Dialect | Status | Runtime model |
| --- | --- | --- |
| MySQL | Stable | Native client/server protocol |
| PostgreSQL | Stable | Native client/server protocol |
| SQLite | Development | Embedded Node.js `node:sqlite` runtime |
| SQL Server | Planned | Native client/server runtime |
| Oracle | Planned | Native client/server runtime |

Stable v1 qualification currently covers Node.js 22/24/26, MySQL 8.4/9.7 and PostgreSQL 15/16/17/18. SQLite is active post-v1 development.

## Preferred client API

### Portable SQL

```js
const result = await db.query(sql`
  SELECT id, name
  FROM ${sql.identifier('users')}
  WHERE email = ${email}
`);
```

For MySQL this compiles to `WHERE email = ?`. For PostgreSQL it compiles to `WHERE email = $1`. Parameters remain separate from SQL text.

Nested fragments and safe identifier composition are supported:

```js
const columns = sql.join([
  sql`${sql.identifier('id')}`,
  sql`${sql.identifier('name')}`
]);

const rows = await db.all(sql`
  SELECT ${columns}
  FROM ${sql.identifier('app', 'users')}
`);
```

### Portable prepared statements

Prepare once and execute repeatedly with named bindings:

```js
const findUser = await db.prepare(sql`
  SELECT id, name, email
  FROM ${sql.identifier('users')}
  WHERE id = ${sql.parameter('id')}
`);

const first = await findUser.one({ id: 42 });
const second = await findUser.one({ id: 84 });

await findUser.close();
```

`sql.parameter()` is compiled to the selected dialect's native placeholder form. The statement keeps the underlying prepared resource and, when created from a pooled client, leases exactly one native connection until `close()`. NuBloxSQL releases that connection automatically when the statement closes. Statements created inside `transaction()` are also closed before the transaction connection returns to the pool.

Prepared writes use the same contract:

```js
const insertUser = await db.prepare(sql`
  INSERT INTO ${sql.identifier('users')} (id, name)
  VALUES (${sql.parameter('id')}, ${sql.parameter('name')})
`);

await insertUser.execute({ id: 1, name: 'Stephen' });
await insertUser.execute({ id: 2, name: 'Alice' });
await insertUser.close();
```

Missing named bindings fail explicitly. `sql.parameter()` is intentionally rejected by ordinary `query()`/`execute()` calls so unresolved parameters cannot accidentally reach a database.

### Portable streaming

`stream()` exposes one async-iterable row contract while retaining each database's native streaming implementation:

```js
const rows = db.stream(sql`
  SELECT id, event_type, created_at
  FROM ${sql.identifier('audit_log')}
  WHERE created_at >= ${startDate}
  ORDER BY created_at
`, {
  batchSize: 128,
  highWaterMark: 16,
  timeout: 30_000,
  signal
});

for await (const row of rows) {
  processRow(row);
}
```

NuBloxSQL does not buffer the complete result to simulate streaming:

- **MySQL** uses the native row stream and socket backpressure. Parameterised streams use prepared execution and binary row decoding rather than SQL literal interpolation.
- **PostgreSQL** uses a transaction-scoped server portal and batched fetches. NuBloxSQL owns the temporary transaction and pooled connection lifecycle when necessary.
- **SQLite** uses lazy prepared-statement iteration.

Early termination is explicit and deterministic:

```js
const rows = db.stream(sql`SELECT * FROM ${sql.identifier('events')}`);

for await (const row of rows) {
  if (shouldStop(row)) break;
}
```

Breaking from async iteration invokes the stream's iterator cleanup. `await rows.close()` is also available when explicit shutdown is preferred. Outstanding public streams are closed before `db.close()` releases client resources.

### Unified result contract

`query()` and `execute()` return a portable result envelope:

```js
{
  rows,
  fields,
  rowCount,
  affectedRows,
  insertId,
  command,
  dialect,
  native
}
```

`native` retains the original dialect result so NuBloxSQL does not discard engine-specific information.

Convenience methods:

```js
const rows = await db.all(sql`SELECT * FROM ${sql.identifier('users')}`);
const user = await db.one(sql`SELECT * FROM ${sql.identifier('users')} WHERE id = ${id}`);
```

`one()` requires exactly one row and rejects otherwise.

### Portable errors

Public client operations expose `NuBloxSqlError` with stable categories while retaining the original engine error:

```js
const { NuBloxSqlError } = require('nubloxsql');

try {
  await db.execute(sql`
    INSERT INTO ${sql.identifier('users')} (email)
    VALUES (${email})
  `);
} catch (error) {
  if (error instanceof NuBloxSqlError && error.category === 'unique_violation') {
    // portable application behavior
  }

  console.log(error.sqlState);
  console.log(error.nativeCode);
  console.log(error.native);
}
```

Portable categories currently include authentication, authorization, connection, timeout, cancellation, constraint violations, unique/foreign-key/not-null violations, syntax, deadlock, serialization, resource limits, state, cardinality and unsupported capabilities.

NuBloxSQL preserves native diagnostics such as PostgreSQL SQLSTATE, MySQL error numbers and SQLite result codes. Ordinary application exceptions thrown from callbacks such as `transaction()` remain ordinary application exceptions rather than being misclassified as database errors.

### Transactions

```js
await db.transaction(async tx => {
  await tx.execute(sql`
    UPDATE accounts
    SET balance = balance - ${100}
    WHERE id = ${sourceId}
  `);

  await tx.execute(sql`
    UPDATE accounts
    SET balance = balance + ${100}
    WHERE id = ${destinationId}
  `);
});
```

NuBloxSQL owns acquisition, commit, rollback and release. The dialect runtime owns the native transaction semantics.

### Capabilities

```js
if (db.supports('serverSideCursors')) {
  // use an advanced native capability
}

console.log(db.capabilities);
```

Unsupported database features are represented honestly rather than silently emulated.

### Native escape hatch

The portable client does not hide the underlying runtime:

```js
const nativeResource = db.native;
const nativeAdapter = db.adapter;
```

The package-level dialect APIs remain available from the same installation:

```js
const nublox = require('nubloxsql');

nublox.mysql;
nublox.postgresql;
nublox.sqlite;
```

## Low-level APIs

`createConnection()` and `createPool()` remain available for developers who intentionally want direct dialect-runtime control:

```js
const nublox = require('nubloxsql');

const connection = nublox.createConnection({
  dialect: 'postgresql',
  host: '127.0.0.1',
  user: 'app',
  database: 'app'
});
```

These are advanced primitives. `createClient()` is the primary developer-facing API.

## Architecture

NuBloxSQL has three internal layers:

1. **Developer client** — portable SQL compilation, prepared statements, streaming, error normalization, result normalization, transactions and lifecycle.
2. **Shared SQL contracts** — capabilities and semantics proven across dialects.
3. **Native dialect runtimes** — database-specific implementation and native behavior.

```text
                       nubloxsql
                  developer client API
                         │
                         ▼
                  shared SQL contracts
                         │
        ┌────────────────┼────────────────┐
        ▼                ▼                ▼
      MySQL          PostgreSQL         SQLite
   implementation    implementation   implementation
```

The implementation is one runtime tree: shared contracts live under `lib/core`, the developer client under `lib/client`, and native database runtimes under `lib/dialects/<dialect>`.

See [Design intent](docs/architecture/design-intent.md) and [Multi-dialect architecture](docs/architecture/multi-dialect.md).

## Platform design rules

NuBloxSQL must:

- provide one install and one import for developers;
- keep common APIs coherent where semantics are genuinely portable;
- preserve database-specific semantics where they are not portable;
- expose capability discovery instead of pretending every engine supports the same features;
- preserve type fidelity and native diagnostics;
- avoid silent semantic emulation;
- keep native escape hatches accessible from the same NuBloxSQL entry point;
- qualify supported runtime/database versions with executable CI and live-server evidence.

NuBloxSQL is not an ORM and is not intended to erase legitimate SQL dialect differences.

## Verification

```bash
npm run verify
npm run v1:proprietary-audit
npm run v1:release-audit
npm pack --dry-run
```

## Documentation

- [Design intent](docs/architecture/design-intent.md)
- [Multi-dialect architecture](docs/architecture/multi-dialect.md)
- [Roadmap](NUBLOX-SQL-ROADMAP.md)
- [Documentation standard](docs/STYLE.md)
- [v1 support matrix](docs/v1/V1-SUPPORT-MATRIX.md)
- [SQL Core v1 contract](docs/v1/SQL-CORE-V1-CONTRACT.md)

## Licence

NuBloxSQL is proprietary software. Copyright (c) 2026 Stephen J T Spittal. All rights reserved. See [LICENSE](LICENSE).
