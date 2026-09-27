# AbortSignal cancellation

NuBloxSQL supports `AbortSignal` on text-query options for callback and Promise APIs.

```js
const controller = new AbortController();

connection.query({
  sql: 'SELECT SLEEP(30)',
  signal: controller.signal
}, (error, rows) => {
  if (error && error.name === 'AbortError') {
    // cancelled
  }
});

controller.abort('request cancelled');
```

Promise usage uses the same protocol cancellation path:

```js
const controller = new AbortController();
const pending = connection.promise().query({
  sql: 'SELECT SLEEP(30)',
  signal: controller.signal
});

controller.abort();
await pending;
```

## Queue-safe cancellation

Cancellation semantics depend on whether the command has started on the MySQL wire.

- A pre-aborted command never starts and returns an `AbortError` with `code === 'ABORT_ERR'` and `fatal === false`.
- A command cancelled while still waiting behind another command is removed from the protocol queue without disturbing the active command. The cancellation is non-fatal.
- A command cancelled after it has started is connection-fatal. MySQL classic protocol does not provide a safe way to discard an in-flight response and continue reusing the same connection without an out-of-band cancellation channel. NuBloxSQL therefore terminates the connection to preserve protocol synchronization.

The abort reason, when provided by the signal, is exposed as `error.cause`.

## Deadlines and cancellation

`operationTimeout` and `signal` are independent controls and may be supplied together. The first one to terminate the command wins.

`timeout` remains the existing inactivity timeout and is refreshed by protocol activity. `operationTimeout` is an absolute non-refreshing deadline. `AbortSignal` is caller-driven cancellation.

Applications should use:

- `timeout` for stalled network/protocol activity;
- `operationTimeout` for a maximum wall-clock command duration;
- `signal` for request/user/workflow cancellation.

This distinction keeps timeout policy and cancellation ownership explicit.
