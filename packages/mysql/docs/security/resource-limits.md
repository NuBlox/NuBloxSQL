# Resource safety limits

NuBloxSQL applies explicit resource limits at protocol boundaries so a server response cannot force uncontrolled client allocation.

## Inbound logical packet limit

`maxInboundPacketSize` limits the total payload size of one logical inbound MySQL classic-protocol packet. The default is **64 MiB**. It is evaluated after decompression and across protocol fragments before payload parsing. Oversized packets fail with `PROTOCOL_INBOUND_PACKET_TOO_LARGE`.

## Individual field-value limit

`maxFieldSize` limits one length-coded result value before its string, Buffer, JSON, geometry or other variable-length representation is allocated.

The default is **64 MiB**.

```js
const connection = mysql.createConnection({
  ...config,
  maxFieldSize: 64 * 1024 * 1024
});
```

For text-protocol rows, NuBloxSQL inspects the length-coded prefix before normal decoding and before invoking a custom `typeCast`, so application type-casting cannot bypass the allocation boundary. Prepared binary rows enforce the same limit for variable-length protocol types; fixed-width numeric and temporal values are unaffected.

Oversized fields fail with:

```text
PROTOCOL_RESULTSET_FIELD_TOO_LARGE
```

The error exposes `fieldSize`, `limit` and `fatal: true`.

## Result-set column limit

`maxResultSetColumns` bounds the number of columns accepted in a result set before the complete field-metadata collection is built. The default is **4096 columns**. Oversized declarations fail with `PROTOCOL_RESULTSET_COLUMNS_TOO_LARGE`.

## Result-set metadata limit

`maxMetadataSize` bounds cumulative field-definition packet payload for one result set. The default is **8 MiB**. The limit applies to text queries and prepared execution. Oversized metadata fails with `PROTOCOL_RESULTSET_METADATA_TOO_LARGE`.

## Individual row limit

`maxRowSize` limits one logical row packet before row decoding begins. The default is **64 MiB**. It applies to callback, Promise, streaming and async-iteration paths, including prepared binary rows. Oversized rows fail with `PROTOCOL_RESULTSET_ROW_TOO_LARGE`.

## Buffered row-count limit

`maxBufferedRows` limits rows retained by APIs that materialise a complete result in memory. The default is **100,000 rows**. Callback/Promise text queries and prepared execution are covered. Streaming and async iteration are not charged against this aggregate counter because they emit under backpressure. Exceeding the limit fails with `PROTOCOL_RESULTSET_ROWS_TOO_LARGE`.

## Buffered result-set size limit

`maxResultSetSize` limits cumulative row-packet payload retained for one buffered result set. The default is **256 MiB**. Streaming and async iteration are not charged against this aggregate limit. Exceeding it fails with `PROTOCOL_RESULTSET_SIZE_TOO_LARGE`.

## Configuration summary

| Option | Default | Boundary |
| --- | ---: | --- |
| `maxInboundPacketSize` | 64 MiB | One inbound logical MySQL packet |
| `maxFieldSize` | 64 MiB | One length-coded result field value |
| `maxMetadataSize` | 8 MiB | Cumulative field metadata for one result set |
| `maxResultSetColumns` | 4096 | Declared columns in one result set |
| `maxRowSize` | 64 MiB | One row packet |
| `maxBufferedRows` | 100,000 | Rows retained by one buffered result set |
| `maxResultSetSize` | 256 MiB | Cumulative row-packet payload retained by one buffered result set |

All resource-limit values must be positive safe integers. Applications with legitimate workloads above a default can raise the relevant limit explicitly rather than disabling the safety boundary globally.

## M5 resource-safety programme

The M5.1 allocation-safety boundaries now cover inbound logical packets, individual variable-length field values, result-set column counts, cumulative metadata, individual row payloads, buffered row counts and buffered result payload. The next resilience tranche addresses operation deadlines/cancellation, followed by pool admission controls and resilience observability.
