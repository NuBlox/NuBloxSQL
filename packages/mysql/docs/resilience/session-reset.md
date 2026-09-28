# Safe connection session reset

NuBloxSQL exposes MySQL `COM_RESET_CONNECTION` through `connection.resetConnection()` and the Promise equivalent. The API resets server-side session state without closing the socket or re-authenticating the user, while restoring the NuBloxSQL connection baseline before the reset call completes.

## Why NuBloxSQL restores the baseline

MySQL resets session system variables to their corresponding global values, including variables configured implicitly by `SET NAMES`. It also releases prepared statements, clears user variables, rolls back active transactions, restores autocommit, drops temporary tables, resets `LAST_INSERT_ID()`, releases locks and clears current query attributes.

A raw `COM_RESET_CONNECTION` therefore is not sufficient for safe reuse when a NuBloxSQL connection was configured with a specific database or connection collation. NuBloxSQL follows a successful server reset by restoring:

- the configured default database, when one was supplied; and
- the connection character set and collation represented by the configured handshake charset.

The public callback or Promise resolves only after that baseline restoration succeeds.

## Callback API

```js
connection.resetConnection({ operationTimeout: 5000 }, function (error) {
  if (error) {
    throw error;
  }

  // The physical connection is retained and the configured database/charset
  // baseline has been restored.
});
```

## Promise API

```js
await connection.resetConnection({
  operationTimeout: 5000,
  signal
});
```

The Promise resolves to the same Promise connection wrapper.

## Prepared statements

MySQL releases prepared statements during `COM_RESET_CONNECTION`. NuBloxSQL therefore invalidates its local prepared-statement state before sending the reset command:

- cached prepared statements are cleared;
- manual prepared statements are closed and become unusable; and
- subsequent `execute()` calls prepare fresh server-side statements.

This prevents stale statement IDs from surviving a session reset.

## Cancellation and deadlines

`resetConnection()` accepts the same sequence-control options used elsewhere:

- `timeout` for inactivity timeout;
- `operationTimeout` for absolute operation control; and
- `signal` for AbortSignal cancellation.

These options are also applied to the baseline-restoration statements.

## Diagnostics

Completed resets publish on:

```text
nublox.mysql.connection.reset
```

The event contains the connection thread ID, total duration, success state and error code. It does not contain credentials or bind values.

## Live validation

The CI smoke test runs against MySQL 8.4 and 9.7 and verifies that reset:

- preserves the physical connection/thread ID;
- rolls back uncommitted work;
- restores autocommit;
- removes temporary tables;
- clears user variables;
- resets `LAST_INSERT_ID()`;
- invalidates cached and manual prepared statements;
- restores the configured database;
- restores the configured connection charset/collation; and
- permits fresh text and prepared execution afterward.
