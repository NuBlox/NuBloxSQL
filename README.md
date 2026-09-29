# NuBloxSQL

**NuBloxSQL is a single-entry, multi-dialect SQL database integration platform for Node.js.**

Its design goal is simple: developers install and import NuBloxSQL once, select a database dialect, and use one coherent platform across SQL engines without having to assemble or manage a separate driver package for every database family.

```bash
npm install nubloxsql
```

```js
const sql = require('nubloxsql');

const db = sql.createConnection({
  dialect: 'postgresql',
  host: '127.0.0.1',
  user: 'app',
  password: process.env.DB_PASSWORD,
  database: 'app'
});

await db.connect();
const result = await db.query('SELECT 1 AS ok');
await db.end();
```

## The NuBloxSQL model

NuBloxSQL provides **one developer-facing entry point** over multiple native SQL runtimes.

```text
                    application code
                          │
                          ▼
                       NuBloxSQL
                          │
                 dialect selection
                          │
        ┌─────────────────┼─────────────────┐
        ▼                 ▼                 ▼
      MySQL           PostgreSQL          SQLite
   native runtime     native runtime    embedded runtime
```

The public platform owns:

- dialect selection;
- connection creation;
- pooling where supported;
- capability discovery;
- shared execution/result vocabulary;
- transaction and resource-limit policy;
- access to dialect-native extensions when required.

The internal dialect runtimes own the details that genuinely differ between engines: wire protocols, authentication, storage lifecycle, locking, type systems, cancellation, cursors and database-specific metadata semantics.

The governing principle is **one entry point, honest dialect semantics**.

## Supported dialects

| Dialect | Status | Runtime model |
| --- | --- | --- |
| MySQL | Stable | Native client/server protocol |
| PostgreSQL | Stable | Native client/server protocol |
| SQLite | Development | Embedded Node.js `node:sqlite` runtime |
| SQL Server | Planned | Native client/server runtime |
| Oracle | Planned | Native client/server runtime |

Stable v1 qualification currently covers Node.js 22/24/26, MySQL 8.4/9.7 and PostgreSQL 15/16/17/18. SQLite is active post-v1 development.

## Single-entry API

### Create a connection

```js
const sql = require('nubloxsql');

const mysql = sql.createConnection({
  dialect: 'mysql',
  host: '127.0.0.1',
  user: 'app',
  password: process.env.DB_PASSWORD,
  database: 'app'
});

const postgres = sql.createConnection({
  dialect: 'postgresql',
  host: '127.0.0.1',
  user: 'app',
  password: process.env.DB_PASSWORD,
  database: 'app'
});

const sqlite = sql.createConnection({
  dialect: 'sqlite',
  filename: './app.db'
});
```

The two-argument form is also available:

```js
const db = sql.createConnection('postgresql', config);
```

### Create a pool

```js
const pool = sql.createPool({
  dialect: 'mysql',
  host: '127.0.0.1',
  user: 'app',
  password: process.env.DB_PASSWORD,
  database: 'app',
  connectionLimit: 20
});
```

Pooling is available only where the selected dialect runtime supports it. Unsupported capabilities fail explicitly rather than being emulated silently.

### Capability discovery

```js
sql.supports('postgresql', 'serverSideCursors'); // true
sql.supports('sqlite', 'queryCancellation');     // false
```

### Native power without another install

The same NuBloxSQL installation exposes advanced native runtimes when a developer needs database-specific features:

```js
const sql = require('nubloxsql');

const pg = sql.postgresql;
const mysql = sql.mysql;
const sqlite = sql.sqlite;
```

This is an escape hatch within NuBloxSQL, not a requirement to install separate packages.

## Architecture

NuBloxSQL has three internal layers:

1. **Platform facade** — the public single entry point developers use.
2. **Shared SQL contracts** — portable concepts proven across multiple dialects.
3. **Native dialect runtimes** — database-specific implementation and semantics.

```text
                       nubloxsql
                 public platform facade
                         │
                         ▼
                  shared SQL contracts
                         │
        ┌────────────────┼────────────────┐
        ▼                ▼                ▼
      MySQL          PostgreSQL         SQLite
   implementation    implementation   implementation
```

Internal workspace/package boundaries exist for maintainability, testing and independent engineering. They are **not** the intended developer installation model.

See [Design intent](docs/architecture/design-intent.md) and [Multi-dialect architecture](docs/architecture/multi-dialect.md).

## Platform design rules

NuBloxSQL must:

- provide one install and one import for developers;
- keep common APIs coherent across dialects where semantics are genuinely portable;
- preserve database-specific semantics where they are not portable;
- expose capability discovery instead of pretending every engine supports the same features;
- preserve type fidelity and native diagnostics;
- avoid silent semantic emulation;
- keep native escape hatches accessible from the same NuBloxSQL entry point;
- qualify supported runtime/database versions with executable CI and live-server evidence.

NuBloxSQL is not an ORM and is not intended to erase SQL dialect differences.

## Verification

```bash
npm run verify
npm run v1:proprietary-audit
npm run v1:release-audit
npm pack --dry-run
```

## Documentation

- [Design intent](docs/architecture/design-intent.md)
- [Multi-dialect architecture](docs/architecture/multi-dialect.md)
- [Roadmap](NUBLOX-SQL-ROADMAP.md)
- [Documentation standard](docs/STYLE.md)
- [v1 support matrix](docs/v1/V1-SUPPORT-MATRIX.md)
- [SQL Core v1 contract](docs/v1/SQL-CORE-V1-CONTRACT.md)

## Licence

NuBloxSQL is proprietary software. Copyright (c) 2026 Stephen J T Spittal. All rights reserved. See [LICENSE](LICENSE).
