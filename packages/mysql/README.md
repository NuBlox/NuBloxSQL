# @nublox/mysql

`@nublox/mysql` is the **native MySQL runtime of the NuBloxSQL platform**.

## Role in NuBloxSQL

The package owns MySQL connectivity and MySQL-specific runtime semantics. Consumers use it directly when targeting MySQL, while higher-level NuBlox products can rely on the NuBloxSQL platform contract for portable behaviour and use MySQL-native extensions where needed.

## Status

| Item | Value |
| --- | --- |
| Package | `@nublox/mysql` |
| Version | `1.0.0` |
| Status | **Stable** |
| Stable baseline | NuBloxSQL `v1.0.0` |
| Node.js | 22, 24, 26 |
| Qualified MySQL | 8.4, 9.7 |

## Platform contract

The adapter participates in the NuBloxSQL contract for dialect identity, capabilities, execution/results, transactions, resource limits, errors and metadata vocabulary where those concepts are portable.

MySQL-specific protocol, authentication, prepared-statement, session-state and transport semantics remain native to this package.

## Native capabilities

The stable runtime includes:

- native MySQL protocol framing and handshake;
- TLS negotiation;
- `mysql_native_password` and supported `caching_sha2_password` flows;
- simple query execution;
- native prepared statements and binary parameter/result handling;
- transactions and savepoints;
- bounded pooling with session reset before reuse;
- streaming results with socket-level backpressure;
- row/result resource limits;
- operation timeouts, adapter-native deadlines and AbortSignal handling;
- deterministic NuBloxSQL client/server error classification;
- TypeScript declarations.

Capability metadata describes what this adapter implements, not every feature a MySQL server may expose.

## Quick start

```js
const mysql = require('@nublox/mysql');

const connection = mysql.createConnection({
  host: '127.0.0.1',
  user: 'app',
  password: process.env.MYSQL_PASSWORD,
  database: 'app'
});

await connection.connect();
const result = await connection.query('SELECT 1 AS ok');
await connection.end();
```

## Native semantics

NuBloxSQL does not disguise MySQL behaviour as generic SQL behaviour. MySQL capabilities such as classic-protocol framing, authentication plugins, prepared-statement binary protocol, session status and connection-aborting cancellation remain adapter-owned.

Where a portable contract is insufficient, consumers should use the adapter's native API rather than bypassing NuBloxSQL or relying on silent emulation.

## Verification and dependency boundary

The package declares no third-party npm runtime, development, optional or peer dependencies. Runtime implementation uses Node.js built-ins and NuBlox-authored source.

```bash
npm run test --workspace @nublox/mysql
```

The maintained CI matrix additionally exercises live MySQL 8.4 and 9.7 behaviour.

## Related documentation

- [NuBloxSQL overview](../../README.md)
- [Design intent](../../docs/architecture/design-intent.md)
- [Multi-dialect architecture](../../docs/architecture/multi-dialect.md)
- [Stable v1 support matrix](../../docs/v1/V1-SUPPORT-MATRIX.md)
- [v1 migration guide](../../docs/v1/V1-MIGRATION.md)

## Licence

Proprietary software. Copyright (c) 2026 Stephen J T Spittal. See `LICENSE`.
