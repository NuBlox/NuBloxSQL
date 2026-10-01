# SQL, parameters and typed values

## Tagged SQL

`sql` is the portable statement-building entry point:

```js
const statement = sql`
  SELECT id, name
  FROM users
  WHERE id = ${42} AND status = ${'active'}
`;

const compiled = db.compile(statement);
console.log(compiled.text);
console.log(compiled.parameters);
```

NuBloxSQL compiles placeholders for the selected dialect. For example, the same statement can compile to `?` placeholders for MySQL and `$1`, `$2` for PostgreSQL.

## Values versus SQL syntax

Normal interpolation means **bind this as a value**:

```js
sql`SELECT * FROM users WHERE email = ${email}`
```

Do not interpolate SQL keywords, order directions, table names or column names as values.

## Identifiers

Use `sql.identifier()` for identifiers:

```js
const schema = 'public';
const table = 'users';
const column = 'email';

const rows = await db.all(sql`
  SELECT ${sql.identifier(column)}
  FROM ${sql.identifier(schema, table)}
`);
```

Each identifier part is quoted by the selected dialect. Keep identifier selection under application control; quoting prevents syntax injection but does not make arbitrary schema access an appropriate authorization policy.

## Combining fragments

`sql.join()` combines SQL fragments while preserving parameter binding:

```js
const filters = [
  sql`status = ${'active'}`,
  sql`tenant_id = ${tenantId}`
];

const statement = sql`
  SELECT id, name
  FROM users
  WHERE ${sql.join(filters, ' AND ')}
`;
```

Only join trusted SQL fragments produced by the SQL tag. Do not turn user-supplied raw SQL strings into fragments.

## Named parameters for prepared statements

`sql.parameter(name)` is reserved for `prepare()` and represents a binding slot, not an immediate value:

```js
const findUser = await db.prepare(sql`
  SELECT id, name
  FROM users
  WHERE id = ${sql.parameter('id')}
`);

try {
  const row = await findUser.one({ id: 42 });
} finally {
  await findUser.close();
}
```

Calling `db.compile()` on a fragment that still contains named prepared parameters is rejected. Bind them through the prepared statement API.

## Portable typed values

When type intent matters, use `sql.typed(value, typeSpec)` or supply a type to `sql.parameter(name, typeSpec)`.

```js
const id = sql.typed('550e8400-e29b-41d4-a716-446655440000', 'uuid');
const amount = sql.typed('1234567890.1234', 'decimal');

await db.execute(sql`
  INSERT INTO payments (id, amount)
  VALUES (${id}, ${amount})
`);
```

Portable aliases include `decimal`/`numeric` and `uuid`/`guid`, with normalization performed through SQL Core. Exact native wire/storage representation remains dialect-specific.

Typed prepared parameters are supported:

```js
const insert = await db.prepare(sql`
  INSERT INTO payments (id, amount)
  VALUES (
    ${sql.parameter('id', 'uuid')},
    ${sql.parameter('amount', 'decimal')}
  )
`);
```

## Custom type codecs

Client-level `types` configuration and `db.types` allow application-specific encoding/decoding. Use codecs when a database type needs a domain representation in your application; do not use them to bypass SQL parameterisation.

See [Observability and type codecs](09-observability-and-type-codecs.md).

## Raw SQL strings

The client also accepts a raw SQL string:

```js
await db.query('SELECT 1');
```

Raw strings are appropriate for fixed application SQL with no interpolated untrusted values. For dynamic values, prefer the SQL tag.

## Portability rule

The tag makes parameter binding and identifier quoting portable. It does **not** make vendor SQL grammar identical. A PostgreSQL-specific operator or MySQL-specific statement remains vendor-specific even when represented by a tagged fragment. Use the capability model when portability matters.