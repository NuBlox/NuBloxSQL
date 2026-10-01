# NuBloxSQL portable transaction policy

NuBloxSQL exposes one transaction contract across supported dialects while preserving dialect-specific characteristics explicitly.

## Policy discovery

Applications and tooling can inspect transaction behaviour before executing work:

```js
const policy = sql.transactionPolicy('postgresql');
console.log(policy.isolationLevels);
console.log(policy.readOnly);
console.log(policy.deferrable);
```

An existing client exposes the same report:

```js
const policy = db.transactionPolicy();
```

The report states whether the dialect supports transactions, nested transactions/savepoints, selectable isolation levels, per-transaction read-only mode, DEFERRABLE semantics, SQLite transaction modes and NuBloxSQL retry policy.

## Commit and rollback contract

`client.transaction(fn, options)` obeys these rules:

1. the callback is invoked on a transaction-scoped `Client`;
2. successful callback completion commits the transaction;
3. callback failure triggers rollback before the error is rethrown;
4. prepared resources owned by the transaction client are cleaned up;
5. cleanup/rollback failures are attached to the original failure where the underlying runtime exposes them;
6. nested transactions use savepoints and roll back only the nested scope;
7. transaction characteristics cannot be changed inside a nested transaction.

## Portable isolation vocabulary

The public isolation levels are:

- `read-uncommitted`
- `read-committed`
- `repeatable-read`
- `serializable`

The exported `TRANSACTION_ISOLATION_LEVELS` constant contains the canonical list.

Support is dialect-specific and discoverable through `transactionPolicy(dialect).isolationLevels`.

## Dialect characteristics

- **MySQL** — selectable isolation and per-transaction read-only mode; no DEFERRABLE semantics.
- **PostgreSQL** — selectable isolation, read-only and DEFERRABLE semantics.
- **SQLite** — no portable SQL isolation selector; exposes `deferred`, `immediate` and `exclusive` transaction modes through `SQLITE_TRANSACTION_MODES`.
- **SQL Server** — selectable isolation; no NuBloxSQL per-transaction read-only or DEFERRABLE mode.

Unsupported characteristics fail explicitly rather than being silently ignored.

## Nested transactions

Nested `transaction()` calls use deterministic savepoints. Nested callbacks operate on the same transaction-scoped client and therefore the same physical connection.

A nested callback failure rolls back to its savepoint and allows the outer transaction to continue if the caller catches the error. Nested transaction calls cannot define a new isolation level, read-only/DEFERRABLE mode, SQLite mode or retry policy.

## Retry policy

Retries apply only to a root transaction because a retry must start after the previous attempt has completed rollback.

```js
await db.transaction(work, {
  retry: {
    maxAttempts: 3,
    delayMs: attempt => attempt * 50,
    onRetry(error, completedAttempt, nextAttempt) {
      logger.warn({ error, completedAttempt, nextAttempt });
    }
  }
});
```

By default, NuBloxSQL retries only failures marked `retryable: true` or categorized as `deadlock` or `serialization`. A custom `shouldRetry(error, attempt)` predicate can override that decision.

The callback can inspect `tx.transactionAttempt`, starting at `1`.

Legacy `retries` and `retryDelayMs` options remain accepted at the public layer but are removed before options reach native dialect runtimes.

NuBloxSQL does not retry ordinary application failures automatically.
