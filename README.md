# NuBloxSQL

NuBloxSQL is a JavaScript and TypeScript database engineering and management platform: one coherent API across the complete SQL database lifecycle.

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

NuBloxSQL provides one package and one public entry point. The released surface already covers:

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

The complete product direction extends this same model from database-engine selection, installation and initialization through discovery, establishment, development, operation, upgrade, backup/recovery, migration, automation and retirement/decommissioning. These lifecycle domains are roadmap scope; they are not all released APIs today.

The design rule is: **one developer API, honest dialect semantics**.

NuBloxSQL now also includes a read-only local-host lifecycle provider for platform/tool/runtime inspection before installation planning. See [Local host lifecycle inspection provider](docs/guides/29-local-host-lifecycle-provider.md).

## Official applications

NuBloxSQL is the platform beneath official NuBlox database tools.

- **NuBlox Shell** (`apps/shell/`) — interactive REPL and automation-friendly CLI built only on the public `nubloxsql` API.
- **NuBlox SQL Workbench** — planned graphical database engineering/management application using the same public platform boundary.

The Shell's architecture and roadmap are defined in [NuBlox Shell](docs/architecture/SHELL.md).

## User documentation

Start with the [NuBloxSQL User Guides](docs/guides/README.md) for detailed API and operational guidance.

Use the [NuBloxSQL Cookbook](docs/cookbook/README.md) for worked applications and recipes covering CRUD, joins and CTEs, reporting, transactions, streaming, metadata tooling, diagnostics, PostgreSQL/MySQL/SQLite/SQL Server service patterns, bulk movement, observability and migration analysis.

Product direction is governed by one hierarchy:

- [Product Blueprint](docs/product/BLUEPRINT.md) — single product authority and frozen development sequence.
- [Capability Register](docs/product/CAPABILITY-REGISTER.md) — current whole-product maturity and gaps.
- [Roadmap](docs/product/ROADMAP.md) — implementation order beneath the blueprint.
- [Database Lifecycle](docs/architecture/DATABASE-LIFECYCLE.md) — detailed eleven-phase lifecycle model.
- [Database Jobs](docs/architecture/DATABASE-JOBS.md) — durable operation/job/workflow architecture.
- [Competitive Benchmark](docs/product/COMPETITIVE-BENCHMARK.md) — external breadth benchmark only.

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
