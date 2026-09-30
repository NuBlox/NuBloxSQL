# NuBloxSQL client lifecycle

NuBloxSQL exposes one asynchronous lifecycle contract through the public `Client` facade while retaining each dialect's native lifecycle underneath.

## Public states

Every client has a `lifecycleState`:

- `idle` — created but not yet opened by the facade;
- `opening` — an asynchronous open/connect operation is in progress;
- `open` — the client is ready to accept work;
- `closing` — deterministic resource cleanup is in progress;
- `closed` — cleanup has completed or the underlying target is no longer reusable.

`isOpen` and `isClosed` are convenience views of this state.

## Public methods

The public lifecycle methods are deliberately symmetrical:

```js
const db = createClient(config);

await db.open();       // alias: connect()
// ... work ...
await db.close();      // alias: end()
```

`open()` and `connect()` return the same `Client` after the client is ready. `close()` and `end()` resolve after owned resources have been released.

Applications may continue to rely on lazy opening: query, execute, prepare, metadata and transaction operations open the client as needed.

## Concurrency and idempotency

The facade serialises concurrent opens into one underlying open operation and concurrent closes into one cleanup operation.

- repeated open calls while opening share the same underlying transition;
- a failed open returns the client to `idle`, permitting a deliberate retry;
- repeated close/end calls are safe;
- operations attempted while `closing` or after `closed` fail deterministically;
- a closed client is not implicitly reopened.

If close is requested while open is still in progress, NuBloxSQL lets the in-flight open settle and then performs cleanup. This avoids leaking a connection that completed opening after the caller had already requested shutdown.

## Dialect semantics

The lifecycle is a facade contract, not an attempt to erase database differences.

### MySQL, PostgreSQL and SQL Server

A direct client delegates opening to the native connection's asynchronous `connect()` method and cleanup to its native termination method.

### SQLite

SQLite is embedded and has no network handshake. `open()` therefore marks the already-created embedded target ready, while `close()` delegates to the SQLite database close operation. The public methods remain asynchronous so application lifecycle code does not need a dialect branch.

### Pools

A pooled client treats `open` as **logically ready to accept work**. Calling `open()` does not force creation of a physical connection merely to satisfy the facade. Connections remain lazily acquired according to the pool implementation. `close()`/`end()` drains and terminates the owned pool.

## Ownership

A top-level client owns the connection or pool created for it and closes that target. Transaction-scoped clients do not own the borrowed native connection; transaction machinery remains responsible for returning or completing that resource. Prepared statements owned by a client are closed before its owned target is terminated.

## Native access

`client.native` remains available for advanced dialect-specific control. If application code directly terminates the native target, a subsequent facade operation detects a non-reusable target and transitions the client to `closed` rather than silently creating a new resource.
