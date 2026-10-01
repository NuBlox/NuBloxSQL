# NuBloxSQL observability contract

NuBloxSQL exposes one portable telemetry event model across MySQL, PostgreSQL, SQLite and SQL Server.

## Event schema

The public schema is versioned by `OBSERVABILITY_SCHEMA_VERSION` and every emitted event contains:

- `schemaVersion` — event schema version;
- `eventId` / `id` — monotonically increasing event identifier within a client observer;
- `clientId` — process-local client correlation identifier;
- `type` — canonical event type;
- `dialect` — normalized NuBloxSQL dialect;
- `timestamp` — wall-clock epoch milliseconds.

Timed operations additionally emit `phase: start|finish`. Both phases share the same `operationId`, allowing consumers to correlate duration, result and failure information without relying on array position or message text.

## Canonical event types

`OBSERVABILITY_EVENT_TYPES` defines:

- `query`
- `execute`
- `prepare`
- `prepared`
- `transaction`
- `transaction_retry`
- `stream`
- `connection`
- `error`

Applications should branch on these exported constants rather than inventing dialect-specific event names.

## Completion fields

Finish events may include:

- `durationMs`;
- `success`;
- `slow`;
- `rowCount`;
- `affectedRows`;
- `command`;
- pool occupancy snapshots where available.

Failures may include portable `errorCategory`, `errorCode`, `errorName` and `retryable` fields. Native error objects are deliberately not copied into telemetry events.

## Transactions and retries

Transaction operations use the normal timed `transaction` event. When the portable transaction policy schedules another root-transaction attempt, NuBloxSQL emits a `transaction_retry` event with:

- `completedAttempt`;
- `nextAttempt`;
- portable error category/code;
- `retryable: true`.

This event is emitted only after the failed transaction attempt has unwound according to the transaction policy.

## Connections and pools

Portable client lifecycle operations (`open`, `connect`, `close`, `end`) use `connection` events. Pool-backed operations may carry a `pool` snapshot with `total`, `idle`, `borrowed` and `waiting` counts when the native pool exposes those values.

## SQL privacy

SQL text is disabled by default. Set `telemetry.includeSql: true` to include compiled SQL text. Bound values are never interpolated into the emitted SQL text, so parameter values do not enter telemetry through this path.

Applications must still treat SQL text as potentially sensitive because identifiers and SQL literals written directly into a raw string can contain business information.

## Slow-operation policy

`slowQueryThresholdMs` remains supported for query-shaped events (`query`, `execute`, `prepared`, `stream`).

`slowOperationThresholdMs` applies one threshold across every timed operation and takes precedence when set.

## Handler isolation

Telemetry callbacks are observational. Exceptions thrown by `onEvent` or type-specific handlers are swallowed and cannot change database operation results, transaction semantics or cleanup behaviour.

Type-specific callbacks follow the event type, including `onTransactionRetry` for `transaction_retry`.

## Compatibility rule

Consumers should use `schemaVersion`, exported event constants, and documented portable fields. New optional fields may be added compatibly. Removing or changing the meaning of an existing field requires an observability schema-version change.
