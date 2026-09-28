# Binary-log row-event framing

NuBloxSQL separates row-event framing from typed row-value decoding.

The framing layer supports MySQL write, update and delete row events in both v1 and current/v2 forms. It extracts protocol structure that can be interpreted without column-type metadata and preserves the actual row image as bounded raw bytes for the next TABLE_MAP decoding tranche.

For each supported row event the decoder exposes:

- the 48-bit `tableId`;
- row-event flags;
- v2 variable-header / extra-data bytes;
- the length-coded row column count;
- before/after column-present bitmaps as applicable;
- `rowsPayload`, containing the still-encoded row image bytes.

`UPDATE_ROWS_EVENT` exposes independent before-image and after-image bitmaps. Write events expose the after-image bitmap; delete events expose the before-image bitmap.

## TABLE_MAP correlation

The stateful public binlog decoder retains recent `TABLE_MAP_EVENT` structures keyed by the 48-bit table ID. Retention is bounded in two independent dimensions:

- `maxTableMaps`, defaulting to 4,096 entries;
- `maxTableMapBytes`, defaulting to 16 MiB of retained table-map metadata.

```js
var decoder = binlog.createDecoder({
  maxTableMaps: 4096,
  maxTableMapBytes: 16 * 1024 * 1024
});
var event = decoder.decode(buffer);

if (event.tableMapMatched) {
  console.log(event.database, event.table, event.rowsPayload);
}
```

If a single table-map snapshot exceeds `maxTableMapBytes`, it is rejected with `BINLOG_TABLE_MAP_TOO_LARGE`. When aggregate retained metadata exceeds either configured boundary, the oldest retained mappings are evicted until both limits are satisfied.

A matching row event receives the database/table identity and an isolated copy of the relevant table-map metadata. Public `Buffer` values are never the decoder-owned cache buffers, so application mutation cannot corrupt metadata used for later row events.

The table-map cache and retained-byte counter are cleared on `ROTATE_EVENT`, because table IDs are scoped to the current binary-log stream context and stale correlation would be unsafe.

A row event whose declared column count disagrees with its retained table map is rejected with `BINLOG_ROWS_TABLE_MAP_MISMATCH` rather than attempting value decoding against incompatible metadata.

## Safety boundary

This tranche intentionally does **not** decode row values yet. That requires full interpretation of TABLE_MAP column metadata, nullability, per-image null bitmaps and MySQL's type-specific binary encodings.

Framing validates all variable reads before slicing buffers and caps row-event column counts at 4,096 before bitmap calculations. The complete event remains subject to the existing `maxEventSize` and checksum validation boundaries. Retained metadata is bounded separately so a sequence of individually valid events cannot create unbounded cache growth.

This staged design keeps malformed input from reaching speculative type decoding and gives the following tranche a validated `(table map, row image)` pair as its input.

## Validation

Unit coverage exercises:

- write-row framing and TABLE_MAP correlation;
- update before/after bitmaps;
- v1 row-event framing;
- cache invalidation on rotate;
- row/table-map column-count mismatch;
- bounded retained table-map entry count;
- bounded retained table-map byte size;
- eviction at the aggregate byte boundary;
- isolation of public table-map buffers from decoder-owned cache state.

The live MySQL 8.4/9.7 CDC workflow additionally requires a real `WRITE_ROWS_EVENT` from an INSERT, verifies its table-map correlation and checks that the bitmap and encoded row payload are exposed.

The next M7 CDC tranche will interpret TABLE_MAP column metadata and decode typed row images while preserving the same strict allocation and truncation boundaries.
