# NuBloxSQL v1 Gate 3 Evidence — PostgreSQL Production Hardening

Gate 3 establishes `@nublox/postgresql` as a first-class native PostgreSQL production driver for the v1 release baseline.

## Gate status

**COMPLETE** subject to the full PR regression matrix remaining green on the evidence commit.

## Production surface demonstrated

The Gate 3 implementation and live validation cover:

- native TCP connection lifecycle and PostgreSQL SSLRequest/TLS negotiation;
- SCRAM-SHA-256 authentication with server-signature verification plus supported compatibility authentication paths;
- simple-query protocol;
- extended query Parse/Bind/Describe/Execute/Close/Sync protocol;
- named prepared statements and repeated parameterized execution;
- PostgreSQL-native CancelRequest cancellation and post-cancellation connection recovery;
- bounded connection pooling, reset-on-release hygiene, transactions and savepoints;
- server-side portals/cursors with bounded batch retrieval and async iteration;
- bounded `maxRows`, `maxResultBytes` and `maxRowBytes` limits with fail-closed physical connection handling;
- deterministic lossless text type policy, including `int8` as `bigint`, arbitrary-precision `numeric` as `string`, `bytea` as `Buffer`, JSON/JSONB parsing and timezone-safe temporal semantics;
- structured PostgreSQL errors/notices, backend message-size limits, operation timeouts and AbortSignal hooks;
- TypeScript declarations and dry-run package validation.

## Supported PostgreSQL matrix

The v1 support baseline is PostgreSQL **15, 16, 17 and 18**.

Every supported major runs the native runtime suite covering extended protocol, cancellation, pooling, portals, authentication/TLS failure paths, result-limit safety and deterministic type decoding.

Production soak evidence is captured on the oldest and newest v1 support endpoints, PostgreSQL 15 and 18.

## Production evidence environment

The measurements below are observations from ephemeral GitHub-hosted Ubuntu 24.04 runners using Node.js v24.21.0. They are evidence that the driver completes the workload safely and efficiently in CI; they are **not contractual throughput guarantees or comparative benchmark claims**.

### PostgreSQL 15 observation

- 250 simple queries: **75.50 ms**, approximately **3,311 ops/s**;
- 250 prepared executions: **75.16 ms**, approximately **3,326 ops/s**;
- 120 contended pooled queries with `connectionLimit: 4`: **44.07 ms**, approximately **2,723 ops/s**;
- pool completed with **4 total / 4 idle / 0 borrowed / 0 waiting** connections;
- 5,000-row native portal traversal, batch size 128: **18.53 ms**, approximately **269,902 rows/s**;
- timeout/CancelRequest recovery: **104.84 ms**, connection remained reusable;
- 600-query forced-GC memory soak: heap **6,182,216 -> 6,224,504 bytes**, retained growth **42,288 bytes**;
- retained-growth guard: **64 MiB maximum**, passed.

### PostgreSQL 18 observation

- 250 simple queries: **46.38 ms**, approximately **5,390 ops/s**;
- 250 prepared executions: **49.23 ms**, approximately **5,078 ops/s**;
- 120 contended pooled queries with `connectionLimit: 4`: **27.06 ms**, approximately **4,434 ops/s**;
- pool completed with **4 total / 4 idle / 0 borrowed / 0 waiting** connections;
- 5,000-row native portal traversal, batch size 128: **13.24 ms**, approximately **377,588 rows/s**;
- timeout/CancelRequest recovery: **102.79 ms**, connection remained reusable;
- 600-query forced-GC memory soak: heap **6,466,264 -> 6,227,024 bytes**, positive retained growth **0 bytes**;
- retained-growth guard: **64 MiB maximum**, passed.

## Failure-path evidence

The live matrix proves:

- invalid SCRAM credentials are rejected;
- `ssl: require` fails when the server refuses TLS;
- already-aborted connection attempts reject deterministically;
- healthy independent connections remain usable after failed connection attempts;
- result-limit breaches do not return protocol-desynchronised connections to a pool;
- a pool replaces a connection lost to a result-limit breach and continues serving work;
- CancelRequest interrupts in-flight work and, when cancellation succeeds within the grace period, the original connection is reusable.

## Precision and type policy

The v1 driver deliberately avoids silent information loss:

- `int2`, `int4`, `oid` -> JavaScript `number`;
- `int8` -> JavaScript `bigint`;
- PostgreSQL arbitrary-precision `numeric`/`decimal` -> `string`;
- `float4`/`float8` -> `number`, including PostgreSQL NaN and infinities;
- `bytea` -> `Buffer`;
- `json`/`jsonb` -> parsed JavaScript values;
- finite `timestamptz` -> `Date`;
- date/time/timetz/timestamp-without-time-zone/interval -> `string`;
- UUID and unknown/custom text OIDs -> `string`.

This keeps PostgreSQL semantics first-class and avoids introducing a third-party decimal/type dependency.

## Dependency and ownership boundary

`@nublox/postgresql` remains a NuBlox-authored native driver with no npm package dependencies. Gate 3 does not introduce `pg`, a third-party PostgreSQL protocol library, a decimal package or another driver dependency.

The repository proprietary boundary audit and CodeQL remain required merge gates.

## Gate 3 exit decision

Gate 3 is complete when the evidence commit passes:

1. PostgreSQL package contracts and dry-run pack on Node 22/24/26;
2. full live PostgreSQL 15/16/17/18 matrix;
3. production evidence on PostgreSQL 15 and 18;
4. repository CI and SQL Core regression suites;
5. proprietary boundary/protocol fuzz gate;
6. CodeQL.

After those checks pass, the single v1 critical path moves to **Gate 4 — Stabilise SQL Core**.
