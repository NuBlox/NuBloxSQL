# Getting started

## Requirements

NuBloxSQL 1.1.x requires Node.js 22 or newer. The release qualification matrix covers Node.js 22, 24 and 26.

Install the single package:

```bash
npm install nubloxsql
```

CommonJS:

```js
const { createClient, sql } = require('nubloxsql');
```

TypeScript/ES module tooling can import the same public package entry point.

## Create a client

A client owns the portable query API and routes operations to the configured dialect.

```js
const db = createClient({
  dialect: 'postgresql',
  host: '127.0.0.1',
  port: 5432,
  user: 'app',
  password: process.env.DB_PASSWORD,
  database: 'app'
});
```

Supported canonical dialect names are `mysql`, `postgresql`, `sqlite` and `sqlserver`. PostgreSQL aliases `postgres`/`pg` and SQL Server aliases `mssql`/`sql-server` are accepted by the routing/type surface.

A connection URL can also be used:

```js
const db = createClient(process.env.DATABASE_URL);
```

Recognised URL families are `mysql://`/`mysql2://`, `postgres://`/`postgresql://`, `mssql://`/`sqlserver://` and `sqlite:`.

## Run a parameterised query

Use the `sql` template tag for application values. Interpolated values become dialect-native parameters rather than being concatenated into SQL text.

```js
const row = await db.one(sql`
  SELECT id, name, email
  FROM users
  WHERE id = ${42}
`);
```

Use `sql.identifier()` when a table, schema or column name is dynamic:

```js
const table = 'users';
const rows = await db.all(sql`
  SELECT id, name
  FROM ${sql.identifier(table)}
  WHERE active = ${true}
`);
```

Do not pass an identifier as a normal interpolated value. Values and identifiers have different SQL semantics.

## Choose the right result method

`query()` returns the full portable result object. `all()` returns the row array. `one()` requires exactly one row and throws a portable cardinality error if zero or multiple rows are returned. `execute()` returns the portable result object and is normally used for DDL/DML or commands where rows are not the main result.

```js
const result = await db.query(sql`SELECT id, name FROM users`);
console.log(result.rows, result.fields, result.rowCount);

const users = await db.all(sql`SELECT id, name FROM users`);

const user = await db.one(sql`SELECT id, name FROM users WHERE id = ${42}`);

const inserted = await db.execute(sql`
  INSERT INTO users (name) VALUES (${'Stephen'})
`);
console.log(inserted.affectedRows, inserted.insertId);
```

The exact native metadata available in a result differs by dialect and remains available through `result.native`.

## Client lifecycle

Clients open lazily when required by an operation, and expose explicit lifecycle methods as well. `connect()` and `open()` are available when you want connection establishment to happen before the first query.

Always close a client you own:

```js
const db = createClient(config);
try {
  await db.connect();
  const rows = await db.all(sql`SELECT id FROM users`);
} finally {
  await db.close();
}
```

`end()` is also a supported lifecycle alias. A closed client must not be reused.

## Feature checks

Never assume a vendor-specific feature is portable. Query the client when behaviour depends on a capability:

```js
if (db.supports('savepoints')) {
  // safe to use the portable savepoint API
}
```

For richer environment evidence, use `db.capabilityReport()` for the static report or `await db.discoverCapabilities()` when connected server/runtime evidence is required.

## Next steps

Continue with [Connections and pooling](02-connections-and-pooling.md), then [SQL, parameters and typed values](03-sql-parameters-and-types.md).