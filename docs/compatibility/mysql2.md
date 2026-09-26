# mysql2 compatibility

NuBloxSQL is being engineered as a low-friction migration path from mysql2 while adding stronger production diagnostics, cancellation and resilience features.

The compatibility reference for this document is mysql2 `3.24.4`, reviewed on 2026-09-26. The machine-readable source of truth is [`compatibility/mysql2.json`](../../compatibility/mysql2.json).

## Current capability matrix

| Capability | Status | Evidence / next milestone |
| --- | --- | --- |
| `createConnection()` | Supported | Contract + live compatibility tests |
| `createPool()` | Supported | Contract + live compatibility tests |
| `createPoolCluster()` | Supported | Contract test |
| Callback query API | Supported | mysql/mysql2-compatible core surface |
| Promise query API | Supported | Contract + live compatibility tests |
| `escape()`, `escapeId()`, `format()`, `raw()` | Supported | Contract parity checks |
| Placeholder text queries | Supported | Live compatibility tests |
| Transactions | Supported | Live begin/query/rollback checks |
| Pool query flow | Supported | Live compatibility tests |
| MySQL 8.4 / 9.x modern authentication | Supported | Live CI |
| TypeScript declarations | Partial | Present; parity programme remains open |
| ESM consumption | Partial | CommonJS package is importable; native ESM surface remains open |
| AbortSignal cancellation | Partial / NuBlox extension | Promise query cancellation exists; mysql2 call-shape parity is not claimed |
| `execute()` prepared statements | Planned | M3 |
| Prepared statement cache | Planned | M3 |
| Named placeholders | Planned | M3 |
| Compression | Planned | M4 |
| Query attributes | Planned | M6 |
| Binary log / CDC | Planned | M7 |

A capability moves to **Supported** only when executable evidence exists in the repository.

## Migration target

For the overlapping API, the intended migration should be close to an import replacement.

mysql2:

```js
const mysql = require('mysql2/promise');
const pool = mysql.createPool(config);
const [rows] = await pool.query('SELECT * FROM users WHERE id = ?', [id]);
```

NuBloxSQL:

```js
const mysql = require('@nublox/mysql/promise');
const pool = mysql.createPool(config);
const [rows] = await pool.query('SELECT * FROM users WHERE id = ?', [id]);
```

Do not migrate mysql2 applications that depend on `execute()` yet. NuBloxSQL will only claim prepared-statement compatibility after COM_STMT_PREPARE / COM_STMT_EXECUTE and binary-protocol tests are implemented and passing.

## NuBlox extensions already available

The migration surface is intentionally compatible where practical, but NuBloxSQL also exposes production-oriented features that do not require mysql2-compatible call shapes:

- `AbortSignal` cancellation for Promise queries;
- `withTransaction()` with opt-in deadlock and lock-wait retry;
- pool `stats()` and `healthCheck()`;
- async-iterable result streaming through `iterate()`;
- `diagnostics_channel` query, pool and transaction events;
- secure modern authentication with opt-in RSA public-key retrieval.

## Automated checks

Local contract checks:

```bash
npm run test:compat:mysql2:contract
```

Live parity checks require a MySQL server:

```bash
MYSQL_HOST=127.0.0.1 \
MYSQL_PORT=3306 \
MYSQL_USER=root \
MYSQL_PASSWORD=secret \
MYSQL_DATABASE=test \
npm run test:compat:mysql2
```

CI executes the live parity suite against the supported MySQL server matrix.
