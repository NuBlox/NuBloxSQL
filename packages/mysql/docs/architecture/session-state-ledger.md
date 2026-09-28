# Connection session-state ledger

NuBloxSQL maintains a connection-local ledger of session-state changes reported by MySQL through `CLIENT_SESSION_TRACK`.

The ledger is deliberately descriptive rather than predictive: it records the best-known state reported by the server but does not claim that a connection is safe to migrate, replay or fail over. Those decisions belong to later topology and routing policy layers.

## Snapshot API

Callback connections and Promise connections expose:

```js
const state = connection.sessionStateSnapshot();
```

The snapshot contains:

- `version`: increments when a non-empty server state-change batch is applied;
- `schema`: latest reported default schema, initially the configured database;
- `systemVariables`: latest reported values for tracked system variables;
- `stateChanged`: latest generic server state-change marker;
- `gtids` and `gtidEncoding`: latest reported GTID state;
- `transactionCharacteristics`: latest transaction restart characteristics;
- `transactionState`: latest server transaction-state record;
- `unknown`: forward-compatible raw tracker blocks not understood by this release.

Snapshots are copies. Mutating a returned object or raw unknown-state buffer does not modify the connection's internal ledger.

## Change events

A decorated callback connection emits `sessionStateChange` whenever the server reports one or more changes:

```js
connection.on('sessionStateChange', (changes, snapshot) => {
  // changes: decoded blocks from this OK packet
  // snapshot: state after applying those changes
});
```

The event does not contain SQL bind values or credentials.

## Reset semantics

A successful `connection.resetConnection()` clears the ledger after `COM_RESET_CONNECTION` and NuBloxSQL's configured database/charset baseline restoration have completed. The resulting snapshot starts again at version `0`, uses the configured database as its schema baseline and contains no historical tracked system-variable, GTID or transaction records.

A failed reset does not clear the ledger.

## Pool behaviour

Physical connections obtained from callback and Promise pools are decorated with the same ledger. State belongs to the physical MySQL connection, not to the pool object.

## Safety boundary

`CLIENT_SESSION_TRACK` reports selected server state; it is not a complete serialisation of every possible session-side effect. In particular, applications must not interpret an empty or apparently simple snapshot as proof that a physical connection can be transparently moved to another server.

The later M7 routing/failover layer should combine this ledger with explicit routing policy, transaction status, host-role information and conservative rules for untracked or unknown state.
