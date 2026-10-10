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

## Try NuBloxSQL now

The repository includes a runnable Shell, not just library contracts.
From a freshly cloned checkout with Node.js 22 or later:

```bash
npm install --no-package-lock
node apps/shell/bin/nublox.js --demo --format json
node apps/shell/bin/nublox.js --doctor --format json
npm run smoke
```

The demo makes an isolated **in-memory SQLite** database, inserts sample
records, lists tables and runs a real query; it does not access live databases.
The doctor validates a real query and server discovery against in-memory
SQLite by default, or against your configured database:

```bash
# For an existing SQLite database:
node apps/shell/bin/nublox.js --dialect sqlite --filename ./database.sqlite --doctor --format json

# For a configured PostgreSQL/MySQL/SQL Server connection:
node apps/shell/bin/nublox.js --url "$NUBLOX_DATABASE_URL" --doctor --format json
```

The connection check is read-only. For interactive use:

```bash
node apps/shell/bin/nublox.js --dialect sqlite --filename ./database.sqlite
```

Enter `\\help`, `\\server`, `\\tables`, native SQL terminated by `;`,
or `\\quit`. Operational commands also include `\\status`,
`\\disconnect`, `\\reconnect`, `\\reset`, and opt-in, in-memory
`\\history on|off|clear`. Piped REPL SQL errors and incomplete SQL at EOF
now produce a nonzero process exit status. See [NuBlox Shell](apps/shell/README.md).

Read a single SQL statement from a file and save results using terminal
redirection:

```bash
node apps/shell/bin/nublox.js --dialect sqlite --filename ./database.sqlite \
  --stdin --format csv < query.sql > results.csv
```

The Shell does not open the SQL or results files itself; zsh/bash handle
redirection. Use `setopt noclobber` in zsh to prevent an existing results
file being overwritten. `--stdin` is for one SQL statement, **not**
a multi-statement migration or transaction script.

## Graphical Workbench preview

Launch a local graphical SQL workspace without installing a database server:

```bash
npm install --no-package-lock
npm run workbench:demo
```

Open the `http://127.0.0.1:4277/` address displayed in Terminal.
Explore the sample table with server-side paging, sorting and exact-match
filtering; run native SQL, inspect columns and export displayed query results. For an existing SQLite database in read-only mode:

```bash
npm run workbench -- --dialect sqlite --filename "$HOME/nublox-first-run.sqlite" --option mode=readonly
```

The Workbench is **localhost-only, single-session and a preview**. It is not
publicly deployed or separately released. PostgreSQL/MySQL/SQL Server connections
use the core API but are not yet live-qualified end to end through the graphical
app. See [Workbench limitations and security](apps/workbench/README.md).

## First-run walkthrough: create a real database

You can complete this workflow on macOS with Node.js 24 LTS without
installing MySQL, PostgreSQL or SQL Server:

```bash
# In the NuBloxSQL repository:
npm install --no-package-lock
npm run shell:demo
npm run shell:doctor

# Make a real SQLite database and table in your home folder:
npm run shell -- --dialect sqlite --filename "$HOME/nublox-first-run.sqlite" \
  --execute "CREATE TABLE IF NOT EXISTS tasks (id INTEGER PRIMARY KEY, title TEXT NOT NULL)"

# Insert a record:
npm run shell -- --dialect sqlite --filename "$HOME/nublox-first-run.sqlite" \
  --execute "INSERT INTO tasks (title) VALUES ('My first NuBloxSQL task')"

# Browse and query it:
npm run shell -- --dialect sqlite --filename "$HOME/nublox-first-run.sqlite" \
  --command '\tables' --format table
npm run shell -- --dialect sqlite --filename "$HOME/nublox-first-run.sqlite" \
  --execute "SELECT id, title FROM tasks ORDER BY id" --format json

# Enter the real interactive SQL Shell:
npm run shell -- --dialect sqlite --filename "$HOME/nublox-first-run.sqlite"
```

Use `\\help` within the session; `\\quit` exits. The database is a
**real persistent file**, not the isolated in-memory demo.
`npm run smoke` separately verifies this create/browse/query lifecycle in
a temporary database and cleans up test artifacts.

The SQLite connector creates the named database if absent unless a read-only
mode is requested. To inspect an existing database without allowing writes,
use `--option mode=readonly` or a connection with equivalent restricted
database permissions. Do not run native mutating SQL against production
without backups and a qualified change process.

The current Shell is run directly from the source repository. The
`@nublox/shell` package is not yet independently published or release
qualified; these commands do not imply a public Shell npm release.

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
- **NuBlox SQL Workbench** (`apps/workbench/`) — **runnable local graphical preview** built on the public API, with database explorer, SQL editor, result grid, inspector and CSV export. See [Workbench quick start](apps/workbench/README.md). A separately distributed, complete Workbench is still future scope.

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

Historical repository states are preserved by Git history and prior commits/tags. The active working tree contains only current product, architecture, guide, cookbook and release documentation.

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
