# Errors and observability

**Scope:** portable unified-client error/telemetry pattern with native evidence retained.

## Classify database failures

```js
const {
  createClient,
  sql,
  NuBloxSqlError,
  ERROR_CATEGORIES
} = require('nubloxsql');

async function createUser(db, email) {
  try {
    await db.execute(sql`
      INSERT INTO users (email)
      VALUES (${email})
    `);
  } catch (error) {
    if (!(error instanceof NuBloxSqlError)) throw error;

    if (error.category === ERROR_CATEGORIES.UNIQUE_VIOLATION) {
      return { ok: false, code: 'email-already-exists' };
    }

    if (error.category === ERROR_CATEGORIES.TIMEOUT) {
      return { ok: false, code: 'database-timeout' };
    }

    throw error;
  }

  return { ok: true };
}
```

Use portable categories for application policy. Keep `native`, `nativeCode` and `sqlState` for support/diagnostic evidence.

## Do not retry everything

```js
function retryableDatabaseError(error) {
  return error instanceof NuBloxSqlError && error.retryable === true;
}
```

Retry only operations that are themselves safe to repeat. A retryable connection/deadlock/serialization error does not make a non-idempotent external side effect safe.

## Telemetry

```js
const db = createClient({
  dialect: 'postgresql',
  host: process.env.PGHOST,
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  database: process.env.PGDATABASE,
  telemetry: {
    includeSql: false,
    slowQueryThresholdMs: 250,
    onEvent(event) {
      console.log(JSON.stringify({
        type: event.type,
        dialect: event.dialect,
        durationMs: event.durationMs,
        success: event.success,
        slow: event.slow,
        rowCount: event.rowCount,
        affectedRows: event.affectedRows,
        errorCategory: event.errorCategory,
        retryable: event.retryable,
        pool: event.pool
      }));
    }
  }
});
```

Leaving `includeSql` false is a useful default because SQL text can contain schema details and, for raw/non-parameterized application SQL, sensitive literals.

## Request correlation

NuBloxSQL telemetry is database-operation telemetry. Add your own request/job correlation in the application logger around it.

```js
async function handleRequest(requestId, operation) {
  const started = Date.now();
  try {
    return await operation();
  } catch (error) {
    console.error({
      requestId,
      category: error.category || null,
      nativeCode: error.nativeCode || null,
      elapsedMs: Date.now() - started
    });
    throw error;
  }
}
```

Do not log passwords, connection URLs containing credentials, raw authentication payloads or unredacted application data.

## Error response mapping

A service layer can map stable categories to its own protocol while preserving database detail internally.

```js
function toHttpStatus(error) {
  if (!(error instanceof NuBloxSqlError)) return 500;

  switch (error.category) {
    case 'unique_violation':
    case 'foreign_key_violation':
    case 'not_null_violation':
    case 'constraint':
      return 409;
    case 'authentication':
    case 'authorization':
      return 503; // database-side service failure, not end-user auth
    case 'timeout':
    case 'cancelled':
      return 504;
    case 'resource_limit':
      return 503;
    default:
      return 500;
  }
}
```

The correct external status depends on your API contract; the example is a starting point, not a universal HTTP mapping.

## Operational signals worth tracking

- query/execute latency distributions;
- pool borrowed/idle/waiting counts;
- acquisition timeouts;
- database error category counts;
- retries and retry exhaustion;
- cancelled operations;
- result-limit failures;
- slow operation counts;
- connection/open failures;
- per-dialect server/version identity.

See [errors and recovery](../guides/08-errors-retries-and-recovery.md), [observability and codecs](../guides/09-observability-and-type-codecs.md), and [production operation](../guides/13-production-and-troubleshooting.md).
