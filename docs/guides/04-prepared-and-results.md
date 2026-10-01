# Prepared statements and result APIs

## Portable result methods

The unified client exposes four primary execution methods.

### `query()`

Returns a full `ClientResult`:

```js
const result = await db.query(sql`
  SELECT id, name FROM users WHERE active = ${true}
`);

console.log(result.rows);
console.log(result.fields);
console.log(result.rowCount);
console.log(result.command);
console.log(result.dialect);
```

A portable result contains `rows`, `fields`, `rowCount`, `affectedRows`, `insertId`, `command`, `dialect` and `native`. Fields that do not apply to a particular operation are represented by the documented neutral value rather than invented data.

### `all()`

Returns the row array directly:

```js
const rows = await db.all(sql`SELECT id, name FROM users ORDER BY id`);
```

### `one()`

Requires exactly one row:

```js
const row = await db.one(sql`
  SELECT id, name FROM users WHERE id = ${42}
`);
```

Zero rows or multiple rows produce a `NuBloxSqlError` with the portable `cardinality` category. Use `all()` when zero-or-many is valid application behaviour.

### `execute()`

Returns a full result and is useful for commands/DML:

```js
const result = await db.execute(sql`
  UPDATE users SET active = ${false} WHERE id = ${42}
`);

console.log(result.affectedRows);
```

## Reusable prepared statements

Prepare a statement when the same SQL shape is executed repeatedly or when named bindings improve clarity:

```js
const insertUser = await db.prepare(sql`
  INSERT INTO users (id, name)
  VALUES (${sql.parameter('id')}, ${sql.parameter('name')})
`);

try {
  await insertUser.execute({ id: 20, name: 'Prepared' });
  await insertUser.execute({ id: 21, name: 'Prepared Again' });
} finally {
  await insertUser.close();
}
```

The prepared statement exposes its ordered `bindings` array. Missing required named bindings are rejected before successful execution.

Prepared statements expose `query()`, `all()`, `one()` and `execute()` with the same result intent as the client-level methods.

## Prepared statement ownership

A prepared statement is a resource. Close it when no longer needed. When created inside a transaction, do not retain it for use after the transaction resource has ended.

```js
await db.transaction(async (tx) => {
  const statement = await tx.prepare(sql`
    SELECT name FROM users WHERE id = ${sql.parameter('id')}
  `);
  try {
    return await statement.one({ id: 42 });
  } finally {
    await statement.close();
  }
});
```

## Operation options

Prepared operations accept the same core control options as normal operations: timeout, deadline, abort signal, and pool acquisition settings where relevant.

```js
const statement = await db.prepare(sql`
  SELECT id FROM jobs WHERE state = ${sql.parameter('state')}
`, { timeout: 5_000 });

const rows = await statement.all(
  { state: 'ready' },
  { timeout: 2_000 }
);
```

## Native prepared APIs

Each engine also exposes native prepared/cursor facilities through its dialect module. Those APIs intentionally preserve database-specific parameter models, cursor behaviour and metadata. Use them only when the portable `Client` surface is insufficient.

## Result typing

In TypeScript, supply a row type when useful:

```ts
interface UserRow {
  id: number;
  name: string;
}

const rows = await db.all<UserRow>(sql`SELECT id, name FROM users`);
const user = await db.one<UserRow>(sql`SELECT id, name FROM users WHERE id = ${42}`);
```

The generic describes the application-visible row shape; it does not perform runtime schema validation.