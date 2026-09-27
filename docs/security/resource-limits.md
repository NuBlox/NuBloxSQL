# Resource safety limits

NuBloxSQL applies explicit resource limits at protocol boundaries so a server response cannot force uncontrolled client allocation.

## Inbound logical packet limit

`maxInboundPacketSize` limits the total payload size of one logical inbound MySQL classic-protocol packet.

```js
const mysql = require('@nublox/mysql');

const connection = mysql.createConnection({
  host: '127.0.0.1',
  user: 'app',
  database: 'app',
  maxInboundPacketSize: 64 * 1024 * 1024
});
```

The default is **64 MiB**.

The limit is evaluated from packet headers before the packet payload is handed to the existing packet parser. It applies after connection decompression, so zlib and zstd transport compression cannot bypass the logical packet boundary.

MySQL classic-protocol payloads can span multiple 16,777,215-byte fragments. NuBloxSQL tracks the cumulative logical packet size across those fragments rather than treating each fragment as an independent allocation boundary.

When the declared logical packet size exceeds the configured limit, the connection fails with a fatal error:

```text
PROTOCOL_INBOUND_PACKET_TOO_LARGE
```

The error exposes `limit`, `packetLength` and `fatal: true`.

Applications that legitimately exchange larger BLOBs or other large payloads can raise `maxInboundPacketSize` explicitly. The value must be a positive safe integer.

## Result-set column limit

`maxResultSetColumns` bounds the number of columns the client will accept in a result set before allocating the complete field-metadata collection.

The default is **4096 columns**.

```js
const connection = mysql.createConnection({
  ...config,
  maxResultSetColumns: 4096
});
```

The limit applies to both text queries and prepared-statement execution. A result-set header that declares more columns than permitted terminates the connection with:

```text
PROTOCOL_RESULTSET_COLUMNS_TOO_LARGE
```

The error exposes `columnCount`, `limit` and `fatal: true`.

## Result-set metadata limit

`maxMetadataSize` bounds the cumulative classic-protocol payload bytes used by field metadata packets for one result set.

The default is **8 MiB**.

```js
const connection = mysql.createConnection({
  ...config,
  maxMetadataSize: 8 * 1024 * 1024
});
```

NuBloxSQL accumulates the logical packet lengths of the field-definition packets before adding their parsed objects to the result-set metadata collection. The check therefore protects against a large number of individually valid metadata packets. It applies to text-query and prepared-execute result sets.

When cumulative field metadata exceeds the configured limit, the connection fails with:

```text
PROTOCOL_RESULTSET_METADATA_TOO_LARGE
```

The error exposes `metadataSize`, `limit` and `fatal: true`.

## Individual row limit

`maxRowSize` limits the logical classic-protocol payload size of one row packet before row decoding begins.

The default is **64 MiB**.

```js
const connection = mysql.createConnection({
  ...config,
  maxRowSize: 64 * 1024 * 1024
});
```

This limit applies to callback, Promise, streaming and async-iteration result paths, including prepared-statement binary rows. Oversized rows fail with:

```text
PROTOCOL_RESULTSET_ROW_TOO_LARGE
```

The error exposes `rowSize`, `limit` and `fatal: true`.

## Buffered row-count limit

`maxBufferedRows` limits the number of rows retained for one result set by APIs that materialise the complete result in memory.

The default is **100,000 rows**.

```js
const connection = mysql.createConnection({
  ...config,
  maxBufferedRows: 100000
});
```

The limit applies to callback/Promise text queries and prepared execution. Streaming and async iteration do not accumulate this counter because they emit rows under stream backpressure rather than retaining the complete result set.

Exceeding the limit fails with:

```text
PROTOCOL_RESULTSET_ROWS_TOO_LARGE
```

The error exposes `rowCount`, `limit` and `fatal: true`.

## Buffered result-set size limit

`maxResultSetSize` limits the cumulative logical row-packet payload retained for one buffered result set.

The default is **256 MiB**.

```js
const connection = mysql.createConnection({
  ...config,
  maxResultSetSize: 256 * 1024 * 1024
});
```

Like `maxBufferedRows`, this control applies only to result paths that retain all rows in memory. Streaming and async iteration remain governed by `maxRowSize`, the inbound packet limit and stream backpressure.

Exceeding the buffered byte limit fails with:

```text
PROTOCOL_RESULTSET_SIZE_TOO_LARGE
```

The error exposes `resultSetSize`, `limit` and `fatal: true`.

## Configuration summary

| Option | Default | Boundary |
| --- | ---: | --- |
| `maxInboundPacketSize` | 64 MiB | One inbound logical MySQL packet |
| `maxMetadataSize` | 8 MiB | Cumulative field metadata for one result set |
| `maxResultSetColumns` | 4096 | Declared columns in one result set |
| `maxRowSize` | 64 MiB | One decoded row packet |
| `maxBufferedRows` | 100,000 | Rows retained by one buffered result set |
| `maxResultSetSize` | 256 MiB | Cumulative row-packet payload retained by one buffered result set |

All resource-limit values must be positive safe integers. Applications with legitimate workloads above a default can raise the relevant limit explicitly rather than disabling the safety boundary globally.

## M5 resource-safety programme

The current M5 boundaries cover inbound logical packets, result-set column counts, cumulative field metadata, individual row payloads and buffered result accumulation. Follow-on work will address field/column value boundaries, operation deadlines/cancellation, pool admission controls and resilience observability with executable tests.
