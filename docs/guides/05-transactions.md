# Transactions and savepoints

## Automatic transaction scope

Use `db.transaction()` for normal application transactions:

```js
await db.transaction(async (tx) => {
  await tx.execute(sql`
    INSERT INTO orders (customer_id, status)
    VALUES (${customerId}, ${'pending'})
  `);

  await tx.execute(sql`
    UPDATE customers
    SET last_order_at = CURRENT_TIMESTAMP
    WHERE id = ${customerId}
  `);
});
```

If the callback completes, NuBloxSQL commits. If the callback throws or rejects, NuBloxSQL rolls back and rethrows the original failure. Cleanup failures are attached without replacing the primary error.

## Never leak transaction work

Use the `tx` client supplied to the callback for all operations that must participate in the transaction. Do not mix `db` and `tx` operations and assume they share the same native connection.

## Savepoints

```js
await db.transaction(async (tx) => {
  await tx.execute(sql`INSERT INTO batch_log (name) VALUES (${'start'})`);

  await tx.savepoint('before_optional');
  try {
    await tx.execute(sql`INSERT INTO optional_data (value) VALUES (${value})`);
  } catch (error) {
    await tx.rollbackTo('before_optional');
  } finally {
    await tx.releaseSavepoint('before_optional');
  }
});
```

The portable methods are `savepoint(name)`, `rollbackTo(name)` and `releaseSavepoint(name)`.

## Nested transactions

Where the dialect reports `nestedTransactions`, calling `tx.transaction()` inside a transaction uses savepoint semantics rather than opening an unrelated transaction:

```js
await db.transaction(async (tx) => {
  await tx.transaction(async (nested) => {
    await nested.execute(sql`INSERT INTO audit_log (message) VALUES (${'nested'})`);
  });
});
```

Check `db.supports('nestedTransactions')` when writing code that may run on multiple dialects.

## Isolation and transaction options

Portable isolation names are:

- `read-uncommitted`
- `read-committed`
- `repeatable-read`
- `serializable`

Example:

```js
await db.transaction(async (tx) => {
  // work
}, {
  isolationLevel: 'serializable',
  readOnly: false
});
```

Not every dialect supports every option. SQLite uses transaction modes (`deferred`, `immediate`, `exclusive`) instead of the portable isolation option in the unified contract:

```js
await db.transaction(async (tx) => {
  // SQLite write transaction
}, { mode: 'immediate' });
```

Unsupported combinations produce a portable `unsupported` error rather than silently pretending the requested semantic was applied.

## Retry policy

The transaction layer supports explicit retry configuration. The legacy-compatible form is:

```js
await db.transaction(work, {
  retries: 2,
  retryDelayMs: 25
});
```

The richer form is:

```js
await db.transaction(work, {
  retry: {
    maxAttempts: 3,
    delayMs: attempt => attempt * 50,
    shouldRetry: (error) => error && error.retryable === true,
    onRetry: (error, completedAttempt, nextAttempt) => {
      console.warn('transaction retry', { completedAttempt, nextAttempt });
    }
  }
});
```

Automatic transaction retry is designed for transient failures. The portable policy identifies deadlock and serialization categories as automatic candidates, and a thrown error can also explicitly carry `retryable: true`.

A transaction callback may execute more than once. Therefore it must not perform non-idempotent external side effects such as sending an email or charging a card unless those effects are coordinated outside the retryable transaction.

## Inspect the policy

```js
const policy = db.transactionPolicy();
console.log(policy.isolationLevels);
console.log(policy.savepoints);
console.log(policy.retries);
```

The top-level `transactionPolicy(dialect)` helper provides the same portable description without needing a connected client.