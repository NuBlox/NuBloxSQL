# PostgreSQL Asynchronous Notifications

## Scope

NuBloxSQL exposes PostgreSQL `LISTEN`, `UNLISTEN` and `NOTIFY` as native PostgreSQL capabilities. They are not promoted into SQL Core because their delivery semantics are PostgreSQL session semantics rather than a portable relational contract.

## Protocol handling

PostgreSQL sends `NotificationResponse` (`A`) messages asynchronously. NuBloxSQL decodes each response into:

```js
{
  processId,
  channel,
  payload
}
```

The runtime intercepts these messages independently of the active query state and emits a `notification` event on the physical PostgreSQL connection. This is intentional: notifications must be safe while the connection is idle and while another command is in flight.

## Connection API

```js
await connection.listen('orders');

connection.on('notification', notification => {
  // notification.processId
  // notification.channel
  // notification.payload
});

await connection.notify('orders', 'ready');
await connection.unlisten('orders');
await connection.unlistenAll();
```

Channel identifiers are quoted as PostgreSQL identifiers. Notification payloads are sent through `pg_notify($1, $2)` using the existing extended-query parameter path rather than string interpolation.

## Pool semantics

A PostgreSQL LISTEN registration belongs to one server session. Therefore a pooled subscription must retain the same physical connection for its lifetime.

```js
const subscription = await pool.listen('orders');

subscription.on('notification', notification => {
  // handle matching channel notifications
});

await pool.notify('orders', 'ready');
await subscription.close();
```

`pool.listen()` checks out a connection and does not return it to the pool until `subscription.close()`. Closing the subscription executes `UNLISTEN`, detaches the notification listener and then returns the connection through the normal pool reset path.

This avoids the invalid design of issuing `LISTEN` through an arbitrary pooled query and then returning that registered session to unrelated work.

## Transactions

NuBloxSQL does not disguise PostgreSQL transaction semantics:

- `LISTEN` and `UNLISTEN` take effect according to PostgreSQL transaction rules.
- `NOTIFY` delivery follows PostgreSQL commit semantics.
- callers that need deterministic registration should complete the `listen()` operation before expecting notifications.

## Qualification

The PostgreSQL CI matrix qualifies asynchronous notification behaviour against PostgreSQL 15, 16, 17 and 18. Qualification covers:

- wire decoding of `NotificationResponse`;
- idle notification delivery;
- delivery while another query is active;
- payload and sender PID fidelity;
- `UNLISTEN` behaviour;
- dedicated pooled subscriptions;
- pooled notification sending;
- post-subscription pool reuse;
- existing PostgreSQL query, COPY, cancellation, pooling, type and production-evidence regression suites.
