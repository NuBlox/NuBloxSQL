# @nublox/postgresql

`@nublox/postgresql` is the **native PostgreSQL runtime of the NuBloxSQL platform**.

## Role in NuBloxSQL

The package owns PostgreSQL connectivity and PostgreSQL-specific runtime semantics. PostgreSQL is also a critical reference dialect because its schemas, type OIDs, cancellation, portals and extended-query lifecycle pressure-test whether NuBloxSQL portable contracts are genuinely database-neutral.

## Status

| Item | Value |
| --- | --- |
| Package | `@nublox/postgresql` |
| Version | `1.0.0` |
| Status | **Stable** |
| Stable baseline | NuBloxSQL `v1.0.0` |
| Node.js | 22, 24, 26 |
| Qualified PostgreSQL | 15, 16, 17, 18 |

## Platform contract

The adapter participates in the NuBloxSQL contract for dialect identity, capabilities, execution/results, transactions, resource limits, errors and metadata vocabulary where those concepts are portable.

PostgreSQL-specific protocol, schema/catalog semantics, portal lifecycle, type OIDs and CancelRequest behaviour remain native to this package.

## Native capabilities

The stable runtime includes:

- native TCP lifecycle and PostgreSQL SSLRequest negotiation;
- StartupMessage and PostgreSQL frontend/backend protocol primitives;
- cleartext, MD5 compatibility and SCRAM-SHA-256 authentication;
- simple-query protocol;
- extended-query Parse/Bind/Describe/Execute/Close/Sync protocol;
- named prepared statements and parameterized execution;
- native CancelRequest cancellation with race-safe backend ownership;
- bounded connection pooling and release hygiene;
- transactions and savepoints;
- server-side portals/cursors with bounded batches and async iteration;
- row/result resource limits with fail-closed connection handling;
- deterministic lossless text type decoding;
- structured PostgreSQL errors and notices;
- TypeScript declarations.

Capability metadata describes what this adapter implements, not every feature PostgreSQL may expose.

## Quick start

```js
const { createConnection } = require('@nublox/postgresql');

const connection = createConnection({
  host: '127.0.0.1',
  port: 5432,
  user: 'app',
  password: process.env.PGPASSWORD,
  database: 'appdb',
  ssl: 'prefer'
});

await connection.connect();
const result = await connection.query('SELECT 1::int4 AS answer');
await connection.end();
```

## Native semantics

PostgreSQL-native features are not flattened into MySQL-shaped concepts. Schemas remain schemas, portals remain PostgreSQL server-side resources, CancelRequest remains a PostgreSQL backend-session operation, and unknown/custom OIDs remain lossless rather than guessed.

### Type fidelity

| PostgreSQL type | JavaScript value |
| --- | --- |
| `bool` | `boolean` |
| `int2`, `int4`, `oid` | `number` |
| `int8` | `bigint` |
| `float4`, `float8` | `number` |
| `numeric`, `decimal` | `string` |
| `bytea` | `Buffer` |
| `json`, `jsonb` | parsed JavaScript value |
| finite `timestamptz` | `Date` |
| `date`, `time`, `timetz`, `timestamp`, `interval` | `string` |
| `uuid` | `string` |
| unknown/custom text OIDs | `string` |

`timestamp without time zone` stays a string so the driver does not invent timezone meaning. Arbitrary-precision numerics remain strings to avoid silent IEEE-754 loss.

## Verification and dependency boundary

The package declares no third-party npm runtime, development, optional or peer dependencies. Runtime implementation uses Node.js built-ins and NuBlox-authored source.

```bash
npm run test --workspace @nublox/postgresql
```

The maintained CI matrix additionally exercises live PostgreSQL 15, 16, 17 and 18 behaviour.

## Related documentation

- [NuBloxSQL overview](../../README.md)
- [Design intent](../../docs/architecture/design-intent.md)
- [Multi-dialect architecture](../../docs/architecture/multi-dialect.md)
- [Stable v1 support matrix](../../docs/v1/V1-SUPPORT-MATRIX.md)
- [v1 migration guide](../../docs/v1/V1-MIGRATION.md)
- [`0.2.0-rc.1` historical release note](docs/releases/0.2.0-rc.1.md)

## Licence

Proprietary software. Copyright (c) 2026 Stephen J T Spittal. See `LICENSE`.
