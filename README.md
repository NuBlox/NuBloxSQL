# NuBloxSQL

NuBloxSQL is a single-entry SQL database integration platform for Node.js.

```bash
npm install nubloxsql
```

```js
const { createClient, sql } = require('nubloxsql');

const db = createClient({
  dialect: 'postgresql',
  host: '127.0.0.1',
  user: 'app',
  password: process.env.DB_PASSWORD,
  database: 'app'
});

const row = await db.one(sql`SELECT id, name FROM users WHERE id = ${42}`);
await db.close();
```

## Current release line

Repository package version: **1.1.0**.

| Dialect | Release status | Qualification |
| --- | --- | --- |
| PostgreSQL | Tier 1 | Qualified across PostgreSQL 15–18 |
| MySQL | Tier 1 | Qualified across MySQL 8.4 and 9.7 |
| SQLite | Tier 1 | Qualified on the supported Node.js 22/24/26 matrix |
| SQL Server | Tier 2 | Supported native runtime; maintained outside the Tier-1 qualification gate |

Node.js **22 or newer** is required.

## Public contract

NuBloxSQL provides one package and one public entry point for:

- client and pool creation;
- tagged SQL, identifier quoting and parameter binding;
- prepared statements and transactions;
- streaming and operation control;
- metadata and schema introspection;
- portable query diagnostics with complete native plan retention;
- portable errors with native diagnostics retained;
- runtime capability discovery;
- an executable atomic SQL capability ontology separating engine support from NuBlox compiler coverage;
- direct native-dialect access where portability would hide important engine behaviour.

The design rule is: **one developer API, honest dialect semantics**.

## User documentation

Start with the [NuBloxSQL User Guides](docs/guides/README.md) for detailed API and operational guidance.

Use the [NuBloxSQL Cookbook](docs/cookbook/README.md) for worked applications and recipes covering CRUD, joins and CTEs, reporting, transactions, streaming, metadata tooling, diagnostics, PostgreSQL/MySQL/SQLite/SQL Server service patterns, bulk movement, observability and migration analysis.

Product direction is defined in:

- [Product vision](docs/strategy/PRODUCT-VISION.md)
- [Product capability register](docs/strategy/PRODUCT-CAPABILITY-REGISTER.md)
- [Strategic roadmap](docs/strategy/STRATEGIC-ROADMAP.md)

Other authoritative release documents are:

- [Documentation index](docs/README.md)
- [Release status](docs/RELEASE.md)
- [Support matrix](docs/SUPPORT.md)
- [Public API summary](docs/API.md)
- [1.1.0 release notes](docs/releases/1.1.0.md)

Machine-readable release contracts are kept in `docs/releases/` and are enforced by `npm run release:check`.

Historical design notes, development plans, qualification narratives and superseded package-era documentation are preserved under `docs/archive/` and are **not authoritative for the current release**.

## Verification

```bash
npm install
npm run verify
npm run test:sqlite-production
npm run release:check
```

## Licence

NuBloxSQL is proprietary software. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
Copyright © 2026 Stephen J T Spittal. All rights reserved.
