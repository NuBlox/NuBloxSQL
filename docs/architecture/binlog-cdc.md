# Binary log / CDC architecture

## Purpose

NuBloxSQL's M7 CDC work begins with a bounded, transport-independent MySQL binary-log event decoder. Keeping event decoding separate from replication transport makes the wire parser independently testable and allows future consumers to use the same decoder for live replication streams, captured binlog files and deterministic fixtures.

## Public surface

The decoder is exported from the optional package subpath:

```js
var binlog = require('@nublox/mysql/binlog');
var decoder = binlog.createDecoder({
  maxEventSize: 64 * 1024 * 1024,
  checksumBytes: 4
});

var event = decoder.decode(buffer);
```

ESM and TypeScript entry points are published through the same `./binlog` package export.

## Current event coverage

The initial decoder understands the common 19-byte event header and adds structured fields for:

- `ROTATE_EVENT`;
- `QUERY_EVENT`;
- `FORMAT_DESCRIPTION_EVENT`;
- `XID_EVENT`;
- `TABLE_MAP_EVENT`.

Unknown event types remain forward compatible: the common header is decoded, the event type is retained numerically and the bounded payload is preserved as a `Buffer`.

64-bit rotate positions and transaction XIDs are returned as JavaScript `bigint` values so values above `Number.MAX_SAFE_INTEGER` are not truncated.

## Safety boundary

The decoder treats binary-log bytes as untrusted input.

Before event-specific parsing it validates:

1. the complete 19-byte common header is available;
2. the declared event size is at least the common header size;
3. the event does not exceed the configured `maxEventSize`;
4. the complete declared event is present;
5. configured checksum bytes fit inside the event payload.

Event-specific decoders then perform explicit bounds checks before every variable-length read. Malformed data produces a deterministic `BINLOG_*` error instead of an unchecked buffer read or uncontrolled allocation.

The default `maxEventSize` is 64 MiB. This is deliberately independent from connection-level packet limits because binlog decoding can also be used on captured/offline event buffers.

## Checksums

`checksumBytes` declares how many trailing bytes belong to the event checksum and must therefore be excluded from event-specific payload decoding. The initial tranche preserves those bytes but does not yet validate the checksum algorithm.

Checksum algorithm discovery and CRC32 verification belong to the replication-stream layer because the active algorithm is communicated by the format-description event/session context.

## M7 follow-on work

The next CDC tranches are:

1. `COM_BINLOG_DUMP` / replica registration and a dedicated replication connection lifecycle;
2. format-description state, checksum discovery and CRC32 verification;
3. GTID and previous-GTID event decoding;
4. row-event framing for write/update/delete events;
5. table-map metadata interpretation and typed row-image decoding;
6. backpressure-aware async iteration over live CDC events;
7. reconnect/resume checkpoints using binlog filename/position and later GTID sets;
8. CDC diagnostics/OpenTelemetry without row-value leakage by default.

A replication stream will use a dedicated physical MySQL connection. It will not share the normal command queue because `COM_BINLOG_DUMP` changes the connection into a long-lived replication event stream.
