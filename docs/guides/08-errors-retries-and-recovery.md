# Errors, retries and recovery

## Portable error surface

NuBloxSQL wraps portable failures in `NuBloxSqlError` where appropriate:

```js
const { NuBloxSqlError } = require('nubloxsql');

try {
  await db.one(sql`SELECT id FROM users WHERE id = ${999999}`);
} catch (error) {
  if (error instanceof NuBloxSqlError) {
    console.error({
      code: error.code,
      category: error.category,
      dialect: error.dialect,
      operation: error.operation,
      retryable: error.retryable,
      sqlState: error.sqlState,
      nativeCode: error.nativeCode
    });
  }
  throw error;
}
```

The original/native evidence is retained through `native` and `cause` where available.

## Error categories

Portable categories include authentication, authorization, connection, timeout, cancelled, constraint, unique violation, foreign-key violation, not-null violation, syntax, deadlock, serialization, resource limit, state, cardinality, unsupported and unknown.

Use `category` for application policy. Do not parse vendor error message text when a portable category already expresses the condition.

## Cardinality errors

`one()` is strict. If the result does not contain exactly one row it throws a cardinality error. This is deliberate and useful for enforcing application invariants.

Use `all()` for zero-or-many queries.

## Retryability

`error.retryable` communicates NuBloxSQL's current retry classification. It is evidence, not permission to retry every operation blindly.

A safe retry also depends on application semantics. Read-only queries are usually easier to retry than commands with external side effects. Transaction retries are safest when all database changes are inside the transaction callback and external side effects are deferred until after commit.

## Transaction retry

Use the transaction retry policy rather than hand-writing loops around partial transaction state:

```js
await db.transaction(async (tx) => {
  await tx.execute(sql`UPDATE counters SET value = value + 1 WHERE id = ${id}`);
}, {
  retry: {
    maxAttempts: 3,
    delayMs: attempt => 25 * attempt
  }
});
```

Deadlock and serialization failures are the portable automatic retry categories. A custom `shouldRetry` callback can make application-specific decisions.

## Constraint handling

```js
try {
  await db.execute(sql`
    INSERT INTO users (email) VALUES (${email})
  `);
} catch (error) {
  if (error instanceof NuBloxSqlError && error.category === 'unique_violation') {
    // map to an application-level "already exists" result
    return;
  }
  throw error;
}
```

Do not expose raw native database errors directly to untrusted clients. They can reveal schema, SQL text or infrastructure detail.

## Connection failures

Connection failures can be transient or permanent. Authentication failure is not a useful automatic retry candidate. A network timeout may be transient. Corrupt SQLite storage is classified as non-retryable even though it is a storage/connection-level failure.

## Cancellation and timeout

A cancelled or timed-out operation may have engine-specific server state. NuBloxSQL's native adapters implement cleanup/cancellation semantics, but applications should still treat a cancelled write as requiring database-level confirmation if business correctness depends on whether it committed.

## Logging guidance

Log identifiers that help correlate failures: portable category/code, dialect, operation, retryable flag, SQLSTATE/native code and a request/operation correlation ID. Avoid logging database passwords, private keys or sensitive parameter values. SQL text logging is opt-in through telemetry and should be governed by your data-classification policy.