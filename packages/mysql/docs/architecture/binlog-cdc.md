# Binary log / CDC architecture

## Purpose

NuBloxSQL M7 CDC separates MySQL binary-log event decoding from the long-lived replication transport. The decoder can therefore be tested independently and reused for live replication streams, captured binlog files and deterministic fixtures.

## Event decoder

The decoder is exported from the optional package subpath:

```js
var binlog = require('@nublox/mysql/binlog');
var decoder = binlog.createDecoder({
  maxEventSize: 64 * 1024 * 1024,
  checksumBytes: 'auto'
});

var event = decoder.decode(buffer);
```

The decoder understands the common 19-byte event header and adds structured fields for:

- `ROTATE_EVENT`;
- `QUERY_EVENT`;
- `FORMAT_DESCRIPTION_EVENT`;
- `XID_EVENT`;
- `TABLE_MAP_EVENT`;
- `GTID_LOG_EVENT`;
- `ANONYMOUS_GTID_LOG_EVENT`;
- `PREVIOUS_GTIDS_LOG_EVENT`.

Unknown event types remain forward compatible: the common header is decoded, the event type is retained numerically and the bounded payload is preserved as a `Buffer`.

64-bit rotate positions, transaction XIDs, GTID group numbers and GTID interval boundaries are returned as JavaScript `bigint` values so values above `Number.MAX_SAFE_INTEGER` are not truncated.

## GTID event model

`GTID_LOG_EVENT` decoding exposes the source identifier both as the original 16-byte SID and as the canonical UUID text form, together with the 64-bit group number:

```js
if (event.type === binlog.EventTypes.GTID_LOG_EVENT) {
  console.log(event.gtid); // 24bc7850-2c16-11e6-a073-0242ac110002:42
}
```

The fixed GTID body is decoded as:

- one-byte GTID flags;
- 16-byte SID;
- eight-byte GNO;
- optional logical timestamp type;
- optional `lastCommitted` and `sequenceNumber` logical-clock values.

Newer MySQL releases can append commit timestamps, transaction length and server-version metadata after the logical-clock fields. NuBloxSQL preserves those bounded bytes in `gtidExtension` until those fields are promoted into their own compatibility tranche rather than guessing at a newer format.

`ANONYMOUS_GTID_LOG_EVENT` uses the same bounded structural decoder but deliberately returns `gtid: null` and `anonymous: true`; it does not fabricate a globally addressable transaction identifier.

`PREVIOUS_GTIDS_LOG_EVENT` is decoded into SID entries and half-open GTID intervals. Each interval is represented as `{start, end}`, where `start` is included and `end` is the first GNO after the interval, matching MySQL's GTID-set interval model. SID and total interval counts are capped before allocation so malformed binlog input cannot force unbounded arrays.

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
    checksumBytes: 'auto'
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
5. checksum/footer bytes fit inside the event payload;
6. configured CRC32 verification succeeds before event-specific payload interpretation.

Event-specific decoders then perform explicit bounds checks before every variable-length read. GTID-set decoding additionally caps SID and cumulative interval counts before array allocation. Malformed data produces a deterministic `BINLOG_*` error instead of an unchecked buffer read or uncontrolled allocation. A malformed event received from a live dump is connection-fatal because continuing after loss of event framing could silently corrupt CDC state.

The default `maxEventSize` is 64 MiB. This is deliberately independent from connection-level packet limits because binlog decoding can also be used on captured/offline event buffers.

The request packet also validates the protocol-width boundaries for the 32-bit position, 16-bit flags and 32-bit replica server ID before writing bytes to the wire.

## Checksums

NuBloxSQL supports both explicit and format-description-driven checksum handling.

### Automatic discovery

Set:

```js
var decoder = binlog.createDecoder({
  checksumBytes: 'auto'
});
```

When the decoder receives a checksum-aware `FORMAT_DESCRIPTION_EVENT`, it reads the checksum algorithm descriptor and carries that state forward to subsequent events. MySQL introduced the checksum-aware format at server version 5.6.1.

Current algorithm states are exposed through `decoder.checksumAlgorithm` and each decoded event's `checksumAlgorithm` field:

- `unknown` before an automatic decoder has observed a format-description event;
- `undefined` for pre-checksum server formats;
- `off` when subsequent events are checksum-free;
- `crc32` when subsequent events carry CRC32 footers;
- `manual` for an explicitly configured non-CRC footer width.

Automatic mode verifies CRC32 by default. A mismatch raises `BINLOG_CHECKSUM_MISMATCH` before the event-specific body is decoded.

MySQL checksum-aware format-description events themselves carry a four-byte CRC footer even when their descriptor is `OFF`. The decoder follows that rule and masks the mutable `LOG_EVENT_BINLOG_IN_USE_F` bit when verifying the format-description CRC, matching the server's checksum semantics.

### Explicit mode and resume points

An application can continue to provide a numeric footer width:

```js
var decoder = binlog.createDecoder({
  checksumBytes: 4,
  verifyChecksum: true
});
```

Numeric `checksumBytes` preserves the existing explicit behaviour. `verifyChecksum: true` is supported for the four-byte CRC32 footer.

Automatic discovery requires the decoder to see the relevant `FORMAT_DESCRIPTION_EVENT`. A replication consumer that resumes from the middle of an existing binlog file without replaying its format-description event should persist the previously learned checksum state or configure `checksumBytes` explicitly for that resume session.

## Validation

The live CDC workflow starts MySQL 8.4 and 9.7, grants replication privileges to the CI account, records binary-log coordinates, performs real DDL/DML, requests a non-blocking `COM_BINLOG_DUMP` stream and verifies that change events are received and decoded.

Checksum unit coverage includes the standard CRC32 test vector, automatic format-description discovery, checksum-off state, following-event CRC verification, deterministic corruption rejection, mutable `BINLOG_IN_USE` handling and pre-checksum server formats.

GTID unit coverage includes 64-bit GNO boundaries, canonical SID formatting, anonymous GTIDs, logical-clock fields, previous-GTID interval sets, truncation detection, invalid interval rejection and pre-allocation count limits.

This sits alongside the existing Node 22/24/26 unit/package matrix, MySQL 8.4/9.7 live validation, CodeQL, dependency audit and protocol fuzzing.

## M7 follow-on work

Remaining CDC tranches are:

1. `COM_BINLOG_DUMP_GTID` request encoding and live GTID resume validation;
2. row-event framing for write/update/delete events;
3. table-map metadata interpretation and typed row-image decoding;
4. reconnect/resume checkpoints using binlog filename/position and GTID sets;
5. CDC diagnostics/OpenTelemetry without row-value leakage by default.

Server-side cursor / streaming prepared-result support remains the other major M7 protocol capability after CDC.
