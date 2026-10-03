# Portable CRUD service

**Scope:** portable unified-client pattern for PostgreSQL, MySQL and SQLite. The example uses an application-supplied integer key so it does not depend on engine-specific generated-ID behaviour.

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
      await db.execute(sql`
        INSERT INTO customers (id, email, display_name, active)
        VALUES (${input.id}, ${input.email}, ${input.displayName}, ${input.active ? 1 : 0})
      `);
      return input.id;
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
      return result.rowCount === 1;
    }

    async function deleteCustomer(id) {
      const result = await db.execute(sql`
        DELETE FROM customers
        WHERE id = ${id}
      `);
      return result.rowCount === 1;
    }

    const id = await createCustomer({
      id: 1001,
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

Generated identity/sequence handling is deliberately omitted because PostgreSQL, MySQL and SQLite expose different native mechanisms. If your application relies on generated IDs, keep that detail in a small dialect-aware repository function or use the database's native identity mechanism where appropriate.

## Compile DML between Tier-1 dialects

The same package now exposes the capability-aware `dml-v1` compiler for INSERT, UPDATE and DELETE. Use this when the application owns SQL in one Tier-1 source dialect and needs NuBloxSQL to validate and render the same supported mutation for another Tier-1 target.

```js
const { capabilityModel } = require('nubloxsql');

const mutation = capabilityModel.transpileSql(
  'postgresql',
  'mysql',
  `UPDATE customers
   SET display_name = $1
   WHERE id = $2`
);

console.log(mutation.scope);          // dml-v1
console.log(mutation.sql);            // UPDATE `customers` SET ...
console.log(mutation.targetToSource); // [1, 2]
```

The released `dml-v1` grammar covers:

- `INSERT ... VALUES`, including multiple rows;
- `INSERT ... SELECT` using the released query compiler as the source;
- `UPDATE ... SET ... WHERE`;
- `DELETE FROM ... WHERE`;
- `RETURNING` only where the target capability is qualified.

DML parameter bindings are remapped across the whole statement. A PostgreSQL statement that references `$2` before `$1`, for example, preserves that source-binding relationship when rendered to MySQL `?` markers or SQLite numbered markers.

### RETURNING is capability-dependent

Do not assume `RETURNING` is portable merely because the source database accepts it.

PostgreSQL supports it natively. MySQL does not support this compiler capability and NuBloxSQL rejects that target. SQLite support depends on the host runtime, so qualify the connected client first:

```js
const runtime = await capabilityModel.qualifyClient(db);

const deletion = capabilityModel.transpileSql(
  'postgresql',
  'sqlite',
  'DELETE FROM customers WHERE id = $1 RETURNING id',
  { targetQualification: runtime }
);

const removed = await db.all(deletion.sql, [1001]);
```

For MySQL, use a normal DELETE and obtain required application data through an explicit query/transaction design. NuBloxSQL does not silently emulate or discard `RETURNING` semantics.

### Current DML boundary

The first DML compiler scope intentionally does not include `DEFAULT VALUES`, UPSERT/`ON CONFLICT`, MySQL `ON DUPLICATE KEY UPDATE`, `MERGE`, `UPDATE ... FROM`, `DELETE ... USING`, data-modifying CTEs or vendor-specific DML modifiers. Check `capabilityOntology.implementation(...)` and the release API contract before depending on a later feature.

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
- Treat compiler certification and runtime transaction design as separate concerns: successful transpilation proves the requested SQL capability surface, not application-level idempotency or concurrency safety.

See [SQL, parameters and typed values](../guides/03-sql-parameters-and-types.md), [prepared statements and results](../guides/04-prepared-and-results.md), [capabilities and portability](../guides/11-capabilities-and-portability.md), and [errors and recovery](../guides/08-errors-retries-and-recovery.md).
