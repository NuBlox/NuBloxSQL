# MySQL session-state tracking

NuBloxSQL negotiates `CLIENT_SESSION_TRACK` when the server advertises the capability and falls back automatically when it does not.

## Wire behaviour

When session tracking is active, MySQL extends successful OK packets with length-encoded session-state information. NuBloxSQL decodes the protocol-defined tracker blocks and exposes them as `OkPacket.sessionStateChanges`.

Each change has:

- `type`: numeric MySQL tracker type;
- `name`: stable NuBlox name for known tracker types;
- `values`: decoded string values for the tracker;
- `data`: the original block payload as a `Buffer` for forward compatibility.

Known tracker names are:

| MySQL type | NuBlox name | Decoded values |
| ---: | --- | --- |
| 0 | `system_variables` | variable name, new value |
| 1 | `schema` | current schema |
| 2 | `state_change` | server state-change marker |
| 3 | `gtids` | GTID set; `encoding` is also exposed |
| 4 | `transaction_characteristics` | transaction restart characteristics |
| 5 | `transaction_state` | transaction-state record |

Unknown future tracker types are preserved with `name: 'unknown'`, an empty `values` array and the raw `data` buffer rather than being discarded.

## Compatibility

`CLIENT_SESSION_TRACK` is requested by default. During the initial handshake NuBloxSQL removes the capability when the physical server does not advertise support. Applications can explicitly disable it with the existing flag mechanism:

```js
mysql.createConnection({
  flags: '-SESSION_TRACK'
});
```

When session tracking is not negotiated, OK packet parsing retains the legacy packet-terminated message behaviour.

## Safety

Malformed or truncated state blocks fail as controlled fatal parser errors with code `PARSER_SESSION_STATE_INVALID`. Length-coded values are bounds checked before slicing, and lengths outside JavaScript's safe integer range are rejected.

## Why this matters for M7

Session-state information is the prerequisite for safe connection migration, read/write routing and failover. A topology layer must know whether a session carries state that cannot simply be moved to another physical server. This tranche exposes the server's authoritative state-change information without yet making routing decisions automatically.
