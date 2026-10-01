# Transactions, savepoints and retries

**Scope:** portable unified-client transaction pattern. Exact isolation capabilities differ by dialect; query `transactionPolicy()` or `supports()` before assuming a specific option is available.

## Atomic business workflow

The callback passed to `transaction()` commits when it completes and rolls back when it throws.

```js
const { createClient, sql } = require('nubloxsql');

async function placeOrder(db, input) {
  return db.transaction(async (tx) => {
    const customer = await tx.one(sql`
      SELECT id
      FROM customers
      WHERE id = ${input.customerId}
    `);

    const order = await tx.execute(sql`
      INSERT INTO orders (customer_id, status)
      VALUES (${customer.id}, ${'pending'})
    `);

    const orderId = order.insertId;

    for (const item of input.items) {
      await tx.execute(sql`
        INSERT INTO order_lines (order_id, product_id, quantity, unit_price)
        VALUES (${orderId}, ${item.productId}, ${item.quantity}, ${item.unitPrice})
      `);
    }

    await tx.execute(sql`
      UPDATE orders
      SET status = ${'confirmed'}
      WHERE id = ${orderId}
    `);

    return orderId;
  });
}
```

Any thrown error aborts the unit of work. Do not manually commit or rollback inside this callback unless you are intentionally using the lower-level native transaction API instead.

## Savepoint for optional work

Use savepoints when part of a transaction may fail without invalidating the whole business operation.

```js
await db.transaction(async (tx) => {
  await tx.execute(sql`
    INSERT INTO orders (id, customer_id, status)
    VALUES (${1001}, ${42}, ${'confirmed'})
  `);

  await tx.savepoint('optional_audit');

  try {
    await tx.execute(sql`
      INSERT INTO audit_log (event_type, entity_id)
      VALUES (${'order-created'}, ${1001})
    `);
    await tx.releaseSavepoint('optional_audit');
  } catch (error) {
    await tx.rollbackTo('optional_audit');
    await tx.releaseSavepoint('optional_audit');
    // Record the audit failure outside the database or surface it to telemetry.
  }
});
```

Savepoint names are application-controlled identifiers. Keep them static or validate them before use.

## Nested transactions

NuBloxSQL uses the dialect's nested-transaction/savepoint capability where supported.

```js
await db.transaction(async (tx) => {
  await tx.execute(sql`INSERT INTO jobs (name) VALUES (${'outer'})`);

  await tx.transaction(async (nested) => {
    await nested.execute(sql`INSERT INTO jobs (name) VALUES (${'nested'})`);
  });
});
```

Do not assume nested transactions exist on an arbitrary future dialect. Check `db.supports('nestedTransactions')`.

## Retry transient failures

Retries are appropriate only when the operation is safe to repeat and the failure is transient.

```js
await db.transaction(async (tx) => {
  await tx.execute(sql`
    UPDATE inventory
    SET available = available - ${1}
    WHERE product_id = ${productId}
      AND available > 0
  `);
}, {
  retry: {
    maxAttempts: 3,
    delayMs: (attempt) => attempt * 25
  }
});
```

The modern retry policy is designed for retryable database failures such as serialization/deadlock conditions. Application errors are not made retryable merely because a retry count exists.

## Idempotency at service boundaries

Transaction retry is not a replacement for request idempotency. If a web request may itself be delivered twice, store an application idempotency key under a unique constraint.

```js
await db.transaction(async (tx) => {
  await tx.execute(sql`
    INSERT INTO processed_requests (request_key)
    VALUES (${requestKey})
  `);

  await tx.execute(sql`
    INSERT INTO payments (request_key, amount)
    VALUES (${requestKey}, ${amount})
  `);
});
```

A duplicate request then fails the unique constraint before a second payment record can be created. Your application can classify the unique violation and return the previously stored outcome.

## Isolation policy

Inspect the portable policy instead of guessing:

```js
const policy = db.transactionPolicy();
console.log(policy.isolationLevels);
console.log(policy.readOnly);
console.log(policy.deferrable);
```

For SQLite, transaction `mode` (`deferred`, `immediate`, `exclusive`) is relevant. PostgreSQL, MySQL and SQL Server expose different isolation semantics.

See [transactions and savepoints](../guides/05-transactions.md) and [errors, retries and recovery](../guides/08-errors-retries-and-recovery.md).
