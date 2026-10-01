# SQLite feature and value fidelity

NuBloxSQL qualifies SQLite features from the active runtime instead of assuming that every Node.js line embeds the same SQLite build.

## Runtime feature matrix

`connection.featureMatrix()` returns a frozen report containing:

- the active SQLite version;
- compile options reported by SQLite;
- Common Table Expression support;
- window-function support;
- `RETURNING` support;
- UPSERT support;
- JSON function support;
- JSONB support;
- STRICT table support;
- FTS5 availability;
- built-in collation support;
- custom-collation runtime capability.

Feature probes are executed against temporary objects only and are cleaned up before the report is returned. Optional features such as JSONB and FTS5 remain runtime facts rather than package promises.

## Value conventions

`connection.valueConventions()` publishes the SQLite value contract used by the adapter:

- SQL `NULL` -> JavaScript `null`;
- REAL -> JavaScript `number`;
- TEXT -> JavaScript `string`;
- BLOB -> `Uint8Array`;
- INTEGER -> `bigint` when `readBigInts: true`, otherwise safe JavaScript integers only;
- booleans -> INTEGER `0` / `1` by convention;
- date/time values -> ISO-8601 UTC TEXT by convention;
- JSON -> JSON text, with JSONB blobs available only when the active SQLite runtime supports JSONB.

NuBloxSQL does not silently coerce SQLite TEXT into `Date` objects. Applications retain control of timezone and domain semantics.

## Integer fidelity

Applications that need lossless signed 64-bit SQLite INTEGER values should construct the connection with `readBigInts: true`. The release-gated contract verifies values above `Number.MAX_SAFE_INTEGER` round-trip exactly as `bigint`.

## Collations

The feature matrix verifies SQLite's built-in collation path, including `NOCASE`. A future runtime-specific custom-collation API will be reported only if the active `node:sqlite` database object exposes one.

## Release qualification

The SQLite verification suite runs this contract on every supported Node.js line. Stable release qualification therefore checks both SQL feature availability and value fidelity from the same package surface shipped to consumers.
