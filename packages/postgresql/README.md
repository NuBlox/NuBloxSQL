# @nublox/postgresql

Native PostgreSQL adapter for NuBloxSQL.

## Status

- Package: `@nublox/postgresql`
- Version: `1.0.0`
- Status: **Stable**
- NuBloxSQL baseline: **v1.0.0**
- Node.js: **22, 24, 26**
- Qualified PostgreSQL: **15, 16, 17, 18**

## Capabilities

The stable v1 surface includes:

- native TCP lifecycle and PostgreSQL SSLRequest negotiation;
- StartupMessage and protocol 3.0/3.2 primitives;
- cleartext, MD5 compatibility and SCRAM-SHA-256 authentication;
- simple-query protocol;
- extended-query Parse/Bind/Describe/Execute/Close/Sync protocol;
- named prepared statements and one-shot parameterized execution;
- native CancelRequest cancellation with race-safe backend ownership;
- bounded connection pooling and release hygiene;
- transactions and savepoints;
- server-side portals/cursors with bounded batches and async iteration;
- row/result resource limits with fail-closed connection handling;
- deterministic lossless text type decoding;
- structured PostgreSQL errors and notices;
- TypeScript declarations.

Capability flags describe implemented adapter behaviour, not every feature available in PostgreSQL.

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

## Prepared statements

```js
const statement = await connection.prepare(
  'SELECT $1::int4 AS id, $2::text AS name'
);

const result = await statement.execute([1, 'alpha']);
await statement.close();
```

## Type policy

NuBloxSQL preserves PostgreSQL semantics rather than forcing lossy JavaScript coercion.

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

`timestamp without time zone` remains a string so the driver does not invent timezone semantics. Arbitrary-precision numeric values remain strings to prevent silent IEEE-754 precision loss.

## Dependency boundary

The package declares no third-party npm runtime, development, optional or peer dependencies. Production implementation uses Node.js built-ins and NuBlox-authored source.

## Related documentation

- `../../README.md`
- `../../docs/architecture/multi-dialect.md`
- `../../docs/v1/V1-SUPPORT-MATRIX.md`
- `../../docs/v1/V1-MIGRATION.md`
- `docs/releases/0.2.0-rc.1.md` — historical RC note

## Licence

Proprietary software. Copyright (c) 2026 Stephen J T Spittal. See `LICENSE`.
