# Binary log row-event framing

## Purpose

NuBloxSQL decodes row-based CDC in layers. The row-event framing layer validates the event envelope and correlates row events to the most recent `TABLE_MAP_EVENT` before typed column-value decoding is attempted.

This keeps wire-format validation, table identity and row-image selection separate from MySQL type interpretation.

## Supported framing

The decoder currently frames:

- `WRITE_ROWS_EVENT_V1` and `WRITE_ROWS_EVENT`;
- `UPDATE_ROWS_EVENT_V1` and `UPDATE_ROWS_EVENT`;
- `DELETE_ROWS_EVENT_V1` and `DELETE_ROWS_EVENT`.

Current/v2 row events decode the variable-header length and preserve its bounded contents in `extraData`. V1 events use the fixed post-header without a variable-header section.

The legacy pre-GA row-event variants and `PARTIAL_UPDATE_ROWS_EVENT` are intentionally not interpreted by this tranche because their compatibility rules differ from the current MySQL 8.4/9.x formats.

## Event model

Decoded row events expose:

- `tableId` — six-byte MySQL table-map identifier;
- `rowFlags` — two-byte row-event flags;
- `rowColumnCount` — declared row-image width;
- `columnsPresent` — primary column-image bitmap;
- `columnsPresentBefore` — delete/update before-image bitmap where applicable;
- `columnsPresentAfter` — write/update after-image bitmap where applicable;
- `rowsPayload` — bounded raw row-image bytes after the bitmaps;
- `tableMapMatched` — whether a retained `TABLE_MAP_EVENT` matched the table identifier;
- `tableMap` — isolated metadata snapshot when a match exists;
- `database` and `table` — copied from the matched table-map snapshot.

For update events the raw row payload contains alternating before/after row images, matching MySQL's row-event model. Typed row splitting and column-value decoding are a later layer.

## Table-map state

`BinlogDecoder` retains private table-map snapshots keyed by `tableId`. Retention is bounded in two independent dimensions:

- `maxTableMaps`, default `4096` entries;
- `maxTableMapBytes`, default `16 MiB` of retained table-map metadata.

Reusing a table identifier replaces the older snapshot and refreshes its retention position. If adding a new snapshot exceeds either total boundary, the oldest retained mappings are evicted until both limits are satisfied. A single snapshot larger than `maxTableMapBytes` is rejected with `BINLOG_TABLE_MAP_TOO_LARGE` instead of being retained.

`ROTATE_EVENT` clears retained table-map state and the retained-byte counter because table identifiers are scoped to the active binary-log stream context and can be reused after rotation.

The buffers exposed through `event.tableMap` are copies of the decoder's private cached metadata. Mutating a row event therefore cannot corrupt table metadata used by later events.

A row event can still be framed when its table map is unavailable, for example when decoding a capture that starts mid-file. In that case `tableMapMatched` is `false` and the raw row payload remains available. Semantic row decoding must not proceed without compatible table metadata.

If a matching table map exists but its column count disagrees with the row event, decoding fails with `BINLOG_ROWS_TABLE_MAP_MISMATCH` instead of attempting to interpret ambiguous bytes.

## Safety boundaries

The row-event decoder:

1. bounds every post-header and bitmap read against the declared event payload;
2. rejects invalid v2 variable-header lengths;
3. caps row-event column width at 4096, matching the current MySQL server row-event implementation boundary;
4. bounds table-map retention by both entry count and total retained bytes;
5. isolates public table-map buffers from decoder-owned cache buffers;
6. preserves row bytes as a bounded slice of an event already constrained by `maxEventSize`;
7. avoids allocating per-column value arrays until typed decoding is explicitly implemented.

Malformed framing raises deterministic `BINLOG_*` errors. Live replication treats those errors as fatal because continuing after an ambiguous row boundary could silently corrupt CDC state.

## Next layer

The next CDC tranche interprets `TABLE_MAP_EVENT.columnMetadata` by MySQL type and decodes individual before/after row images. That implementation must retain the same bounded-allocation discipline and preserve exact 64-bit values where JavaScript `number` is unsafe.
