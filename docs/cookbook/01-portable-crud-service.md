# Portable CRUD service

**Scope:** portable unified-client pattern. The example runs directly with SQLite and uses only APIs that are also exposed by the unified MySQL and PostgreSQL clients. Adjust the connection configuration and DDL for engine-specific type choices when moving between databases.

## Goal

Build a small customer repository with create, read, update, list and delete operations while keeping values parameterized and resource ownership explicit.

```js
const { createClient, sql } = require('nubloxsql');

async function main() {
  const db = createClient({
    dialect: 'sqlite',
    filename: 'customers.db'
  });

  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS customers (
        id INTEGER PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        display_name TEXT NOT NULL,
        active INTEGER NOT NULL DEFAULT 1
      )
    `);

    async function createCustomer(input) {
      const result = await db.execute(sql`
        INSERT INTO customers (email, display_name, active)
        VALUES (${input.email}, ${input.displayName}, ${input.active ? 1 : 0})
      `);
      return result.insertId;
    }

    async function getCustomer(id) {
      return db.one(sql`
        SELECT id, email, display_name, active
        FROM customers
        WHERE id = ${id}
      `);
    }

    async function listCustomers({ activeOnly = true, limit = 100 } = {}) {
      return db.all(sql`
        SELECT id, email, display_name, active
        FROM customers
        WHERE (${activeOnly ? 1 : 0} = 0 OR active = 1)
        ORDER BY id
        LIMIT ${limit}
      `);
    }

    async function renameCustomer(id, displayName) {
      const result = await db.execute(sql`
        UPDATE customers
        SET display_name = ${displayName}
        WHERE id = ${id}
      `);
      return Number(result.affectedRows) === 1;
    }

    async function deleteCustomer(id) {
      const result = await db.execute(sql`
        DELETE FROM customers
        WHERE id = ${id}
      `);
      return Number(result.affectedRows) === 1;
    }

    const id = await createCustomer({
      email: 'stephen@example.com',
      displayName: 'Stephen',
      active: true
    });

    console.log(await getCustomer(id));
    await renameCustomer(id, 'Stephen S');
    console.log(await listCustomers());
    await deleteCustomer(id);
  } finally {
    await db.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
```

## Dynamic table names

Values and identifiers are different. Values are parameterized automatically; identifiers must be quoted as identifiers.

```js
const table = 'customers';
const rows = await db.all(sql`
  SELECT id, email
  FROM ${sql.identifier(table)}
  ORDER BY id
`);
```

Never substitute a user-provided identifier until the application has validated it against an allowlist.

## Result API choice

Use the narrowest operation that describes your expectation:

- `all()` when zero or more rows are expected;
- `one()` when exactly one row is expected;
- `query()` when rows plus field/native result metadata are required;
- `execute()` for commands and mutations;
- `prepare()` for a statement executed repeatedly.

`one()` raises a portable cardinality error if the result does not contain exactly one row. If absence is normal application behaviour, query with `all()` and handle an empty array, or design a repository helper around that rule.

## Production notes

- Put uniqueness and referential rules in the database rather than relying only on application checks.
- Use transactions for multi-statement state changes.
- Apply operation timeouts and result budgets at service boundaries.
- Use pools for external client/server databases; SQLite is embedded and does not expose a pool.

See [SQL, parameters and typed values](../guides/03-sql-parameters-and-types.md), [prepared statements and results](../guides/04-prepared-and-results.md), and [errors and recovery](../guides/08-errors-retries-and-recovery.md).
