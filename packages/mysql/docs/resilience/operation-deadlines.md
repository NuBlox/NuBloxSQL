# Operation deadlines

NuBloxSQL distinguishes an operation deadline from the legacy sequence inactivity timeout.

## `timeout`: inactivity timeout

The existing `timeout` option is refreshed when protocol activity occurs. It protects against a connection that stops making progress, but a long-running operation can remain alive while packets continue to arrive.

## `operationTimeout`: absolute operation deadline

`operationTimeout` is a non-refreshing end-to-end budget in milliseconds. `0` disables the deadline.

```js
connection.query({
  sql: 'SELECT expensive_operation()',
  timeout: 5000,
  operationTimeout: 30000
}, callback);
```

In this example:

- five seconds without protocol progress triggers `PROTOCOL_SEQUENCE_TIMEOUT`;
- thirty seconds total triggers `PROTOCOL_OPERATION_TIMEOUT`, even if packets continue to arrive.

The operation deadline is fatal to the physical connection because the MySQL classic protocol does not provide a safe in-band way to abandon the active command and then continue consuming that same connection without first re-establishing protocol synchronisation.

`operationTimeout` must be a non-negative safe integer.

## Text queries

For `query()`, the absolute deadline is created when the query sequence is created. Time spent queued behind earlier commands therefore consumes the operation budget. When the sequence becomes active, NuBloxSQL starts a timer for the remaining budget; protocol packets do not refresh it.

Promise text queries use the same underlying query sequence. `AbortSignal` remains independently supported; whichever cancellation condition wins first settles the operation and the physical connection is not reused.

## Prepared execution

`execute()` uses one absolute deadline for the entire prepared-operation orchestration:

```js
connection.execute({
  sql: 'SELECT ? + ?',
  values: [20, 22],
  operationTimeout: 30000
}, callback);
```

For a cache miss, the same deadline timestamp is passed to both `COM_STMT_PREPARE` and `COM_STMT_EXECUTE`. A cache hit uses the existing deadline directly for execution. If MySQL requires the driver's one-shot safe reprepare path, that retry also reuses the original deadline rather than receiving a fresh timeout budget.

Pool execution calculates the deadline before waiting for a connection, so pool acquisition time also consumes the same budget. Promise `execute()` uses the same prepared orchestration and therefore receives identical deadline semantics.

This behavior prevents a nominal 30-second operation from expanding into separate 30-second PREPARE, EXECUTE and retry windows.

## Error shape

When the absolute deadline expires, NuBloxSQL raises a fatal error:

```text
PROTOCOL_OPERATION_TIMEOUT
```

The error includes `operationTimeout` with the original configured budget.

## Next cancellation work

M5.2 will next extend first-class `AbortSignal` cancellation from Promise text queries to prepared execution, using the same connection-discard rule so cancelled protocol state is never returned to the pool.
