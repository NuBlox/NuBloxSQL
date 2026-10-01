# NuBloxSQL platform configuration validation

NuBloxSQL validates portable configuration invariants at the single-entry facade before handing configuration to a native dialect runtime.

## Design rule

The facade validates only semantics that NuBloxSQL can define consistently across dialects. Dialect-specific options remain owned by the native adapter and pass through unchanged.

This preserves access to native database capabilities while ensuring that common mistakes fail consistently regardless of the selected SQL engine.

## Connection invariants

For networked dialects the facade validates common connection fields when they are supplied:

- `host` must be a non-empty string;
- `port` must be an integer from 1 through 65535;
- `user` must be a non-empty string;
- `password` and `database` must be strings;
- `connectTimeout` must be a non-negative integer.

The facade does not require optional fields merely because another dialect requires them. Required authentication and database-specific connection semantics remain the responsibility of each native runtime.

## Pool invariants

Common pool configuration is validated before the native pool is created:

- `connectionLimit` must be a positive integer;
- `maxIdle` must be a positive integer and cannot exceed `connectionLimit` when both are explicit;
- `idleTimeout` must be a non-negative integer;
- `acquireTimeout` must be a positive integer;
- `queueLimit` must be a non-negative integer;
- `resetOnRelease` must be boolean when supplied.

The facade rejects contradictory configuration rather than silently clamping or coercing it.

## Client pool aliases

`createClient()` accepts `pool.max` as the portable alias for the native `connectionLimit` setting.

If both `pool.max` and `pool.connectionLimit` are supplied they must be equal. A nested pool limit must also agree with an explicitly supplied top-level limit. This prevents configuration order from silently changing pool behavior.

A dialect without pooling support rejects `pool: true` or a pool options object. `pool: false` remains valid and explicitly requests a direct connection.

## Error contract

Configuration failures currently use `TypeError` or `RangeError` with the transitional code `NUBLOXSQL_CONFIGURATION`. The next facade slice will consolidate facade/routing failures into the stable public NuBloxSQL error surface.

## Compatibility

Unknown options are intentionally not rejected by the platform validator. This is required for native dialect extension options and future runtime capabilities.
