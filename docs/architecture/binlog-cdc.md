# Binary log / CDC architecture

## Purpose

NuBloxSQL M7 CDC separates MySQL binary-log event decoding from the long-lived replication transport. The decoder can therefore be tested independently and reused for live replication streams, captured binlog files and deterministic fixtures.

## Event decoder

The decoder is exported from the optional package subpath:

```js
var binlog = require('@nublox/mysql/binlog');
var decoder = binlog.createDecoder({
  maxEventSize: 64 * 1024 * 1024,
  checksumBytes: 4
});

var event = decoder.decode(buffer);
```

The decoder understands the common 19-byte event header and adds structured fields for:

- `ROTATE_EVENT`;
- `QUERY_EVENT`;
- `FORMAT_DESCRIPTION_EVENT`;
- `XID_EVENT`;
- `TABLE_MAP_EVENT`.

Unknown event types remain forward compatible: the common header is decoded, the event type is retained numerically and the bounded payload is preserved as a `Buffer`.

64-bit rotate positions and transaction XIDs are returned as JavaScript `bigint` values so values above `Number.MAX_SAFE_INTEGER` are not truncated.

## Live replication stream

A live non-GTID stream uses a dedicated physical connection:

```js
var binlog = require('@nublox/mysql/binlog');

var connection = binlog.createReplicationConnection({
  host: '127.0.0.1',
  user: 'cdc_user',
  password: process.env.MYSQL_PASSWORD
});

var dump = connection.binlogDump({
  filename: 'binlog.000123',
  position: 4,
  serverId: 41001,
  decoderOptions: {
    checksumBytes: 4
  }
});

var stream = dump.stream({highWaterMark: 16});

for await (var event of stream) {
  console.log(event.typeName, event.logPosition);
}
```

The replication account requires the server privilege needed to request binary-log streaming (`REPLICATION SLAVE` on current MySQL 8.4 documentation). The requested binlog file and position must still exist on the source.

`COM_BINLOG_DUMP` changes the connection into a long-lived replication stream. For that reason `createReplicationConnection()` creates an explicitly marked connection and applications should not use it for normal query traffic or return it to a general-purpose pool.

The current stream implements non-GTID `COM_BINLOG_DUMP`. `flags: 1` requests `BINLOG_DUMP_NON_BLOCK`, which is useful for bounded reads and integration testing; the default flag value is `0` for a continuous blocking stream.

### Backpressure and shutdown

`dump.stream()` is an object-mode Node `Readable` and therefore also supports async iteration. When the consumer reaches its high-water mark, the underlying connection is paused. Reading resumes the connection.

There is no ordinary command-level cancellation after a connection has entered the dump stream. Destroying the stream, calling `dump.stop()`, or destroying the replication connection closes the dedicated physical connection and terminates the server-side dump stream.

## Safety boundary

The decoder treats binary-log bytes as untrusted input.

Before event-specific parsing it validates:

1. the complete 19-byte common header is available;
2. the declared event size is at least the common header size;
3. the event does not exceed the configured `maxEventSize`;
4. the complete declared event is present;
5. configured checksum bytes fit inside the event payload.

Event-specific decoders then perform explicit bounds checks before every variable-length read. Malformed data produces a deterministic `BINLOG_*` error instead of an unchecked buffer read or uncontrolled allocation. A malformed event received from a live dump is connection-fatal because continuing after loss of event framing could silently corrupt CDC state.

The default `maxEventSize` is 64 MiB. This is deliberately independent from connection-level packet limits because binlog decoding can also be used on captured/offline event buffers.

The request packet also validates the protocol-width boundaries for the 32-bit position, 16-bit flags and 32-bit replica server ID before writing bytes to the wire.

## Checksums

`checksumBytes` declares how many trailing bytes belong to the event checksum and must therefore be excluded from event-specific payload decoding. The current decoder preserves those bytes but does not yet validate the checksum algorithm.

Applications can query the source's active `binlog_checksum` value and pass `checksumBytes: 4` for CRC32 streams. Automatic format-description checksum discovery and CRC32 verification are the next checksum tranche.

## Validation

The live CDC workflow starts MySQL 8.4 and 9.7, grants replication privileges to the CI account, records the current binary-log coordinates, performs real DDL/DML, requests a non-blocking `COM_BINLOG_DUMP` stream from those coordinates and verifies that change events are received and decoded.

This sits alongside the existing Node 22/24/26 unit/package matrix, CodeQL, dependency audit and protocol fuzzing.

## M7 follow-on work

Remaining CDC tranches are:

1. format-description state, automatic checksum discovery and CRC32 verification;
2. GTID and previous-GTID event decoding plus `COM_BINLOG_DUMP_GTID`;
3. row-event framing for write/update/delete events;
4. table-map metadata interpretation and typed row-image decoding;
5. reconnect/resume checkpoints using binlog filename/position and later GTID sets;
6. CDC diagnostics/OpenTelemetry without row-value leakage by default.

Server-side cursor / streaming prepared-result support remains the other major M7 protocol capability after CDC.
