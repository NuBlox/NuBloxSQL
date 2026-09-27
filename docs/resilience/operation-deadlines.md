# Operation deadlines

NuBloxSQL distinguishes an operation deadline from the legacy sequence inactivity timeout.

## `timeout`: inactivity timeout

The existing `timeout` option is refreshed when protocol activity occurs. It protects against a connection that stops making progress, but a long-running operation can remain alive while packets continue to arrive.

## `operationTimeout`: absolute operation deadline

`operationTimeout` is a non-refreshing deadline measured in milliseconds from creation of the query sequence. Queueing time therefore counts toward the deadline. `0` disables the deadline.

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

`operationTimeout` must be a non-negative safe integer. The current M5.2 tranche applies it to text queries, including Promise queries because they use the same underlying query sequence. `AbortSignal` remains independently supported by Promise text queries; whichever cancellation condition wins first settles the operation and the connection is not reused.

Prepared execution will adopt the same absolute-deadline primitive in the next M5.2 tranche so prepare/execute orchestration can share one deadline rather than resetting the budget between protocol phases.
