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

The stateful public binlog decoder retains a bounded LRU-like insertion map of recent `TABLE_MAP_EVENT` structures keyed by the 48-bit table ID. A matching row event receives the database/table identity and a frozen snapshot of the relevant table map.

The default table-map retention cap is 4,096 entries and can be changed with `maxTableMaps`.

```js
var decoder = binlog.createDecoder({maxTableMaps: 4096});
var event = decoder.decode(buffer);

if (event.tableMapMatched) {
  console.log(event.database, event.table, event.rowsPayload);
}
```

The table-map cache is cleared on `ROTATE_EVENT`, because table IDs are scoped to the current binary-log stream context and stale correlation would be unsafe.

A row event whose declared column count disagrees with its retained table map is rejected with `BINLOG_ROWS_TABLE_MAP_MISMATCH` rather than attempting value decoding against incompatible metadata.

## Safety boundary

This tranche intentionally does **not** decode row values yet. That requires full interpretation of TABLE_MAP column metadata, nullability, per-image null bitmaps and MySQL's type-specific binary encodings.

Framing validates all variable reads before slicing buffers and caps row-event column counts at 4,096 before bitmap calculations. The complete event remains subject to the existing `maxEventSize` and checksum validation boundaries.

This staged design keeps malformed input from reaching speculative type decoding and gives the following tranche a validated `(table map, row image)` pair as its input.

## Validation

Unit coverage exercises:

- write-row framing and TABLE_MAP correlation;
- update before/after bitmaps;
- v1 row-event framing;
- cache invalidation on rotate;
- row/table-map column-count mismatch;
- bounded retained table-map state.

The live MySQL 8.4/9.7 CDC workflow additionally requires a real `WRITE_ROWS_EVENT` from an INSERT, verifies its table-map correlation and checks that the bitmap and encoded row payload are exposed.

The next M7 CDC tranche will interpret TABLE_MAP column metadata and decode typed row images while preserving the same strict allocation and truncation boundaries.
