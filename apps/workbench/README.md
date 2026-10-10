# NuBlox SQL Workbench — local preview

The first graphical Workbench is a **real, local-only database application** powered by the existing public NuBloxSQL API. It does not introduce another SQL compiler, driver or ORM.

## Launch

Use Node.js 24 LTS (Node 22+ is tested). From the repository root:

~~~bash
npm install --no-package-lock
npm run workbench:demo
~~~

Open the address printed in Terminal (normally http://127.0.0.1:4277/).
The demo creates a temporary in-memory SQLite table and two rows. It cannot connect to a production database.

For an existing SQLite database, prefer read-only mode:

~~~bash
npm run workbench -- --dialect sqlite --filename "$HOME/nublox-first-run.sqlite" --option mode=readonly
~~~

For a real PostgreSQL, MySQL or SQL Server connection, use the same environment variables/connection arguments supported by NuBlox Shell:

~~~bash
export NUBLOX_DATABASE_URL='postgresql://app@127.0.0.1:5432/app'
npm run workbench
~~~

Use database account privileges to control SQL mutation. The Workbench deliberately executes **native SQL**, which may modify or delete data. It does not offer a server-side, dialect-independent SQL-readonly guarantee. Connection passwords remain in the server process, not the browser; avoid embedding them in command-line arguments or sharing your workstation while it runs.

## Currently implemented

- Live database connection status and database dialect label
- Table explorer with metadata-validated, **database-side pagination**, sorting and exact-match filtering (50 rows per page by default)
- Schema-aware, safely quoted previews where metadata is available; filter **values are parameterized** through the public NuBloxSQL tagged-SQL API
- Column/type/key inspector
- Native SQL editor, Cmd+Enter / Ctrl+Enter to run
- Result table, row count, command and elapsed time
- Server-side table-page limit and browser CSV export of **displayed rows only**; arbitrary SQL editor results still have a 200-row *display* cap
- Browser CSV formula neutralization for leading =, +, - and @ values
- Explicit errors and reloadable catalogues
- Same-origin, loopback-only HTTP API with an unguessable session token, CSP, no CORS or cookies
- Zero third-party dependencies; fully separate from the distributed nubloxsql package

## Deliberate preview limitations

This is a **single-process/single-connection developer preview**, not a published or production multi-user web service. It binds exclusively to 127.0.0.1; do not reverse-proxy, port-forward or expose it publicly. The initial browser view uses native HTML/CSS/JavaScript because it can be launched immediately without violating NuBloxSQL's zero-dependency published runtime. A separate, future **SvelteKit** frontend can consume the same local application boundary.

Table browsing now fetches at most **page size + one** records per request directly from the database, and indicates whether there is a next page. Browsing defaults to 50 rows per page, has an offset limit of 10 million, and allows sorting and **exact equality** filtering only on verified metadata columns. Filter comparisons follow the **native database type and collation semantics**, so case sensitivity and type coercion vary by dialect. Ordering by a non-unique column or changing rows concurrently can cause repeats or omissions with offset pagination; use a unique key or stable snapshot for consistency.

The arbitrary SQL editor still has a **display cap**, not a database-side memory limit. Use bounded SQL and restricted database privileges. Cursor/keyset pagination, query cancellation, database profiles, settings, saved sessions, editable grids, comprehensive SQL Server catalogue parity, migration workflows, installer, backups and recoveries are not delivered here.

The browser receives **only** row data, metadata and an ephemeral API token, never full connection credentials. The local HTTP server does not persist queries, passwords, or result sets. It does not store browser history. Stop it using Ctrl+C.

## Developer qualification

~~~bash
npm run test:workbench
npm run verify
npm run release:check
~~~

The HTTP acceptance suite connects to **real Node SQLite**, verifies the demo and an existing read-only file, exercises object browsing, bounded paging, column-validated sorting, parameterized filters, SQL execution, permissions, wrong-origin and missing-token requests, large inputs and the CLI launcher. Other engine connections use the underlying supported public API but have not yet been live-qualified through this graphical frontend.

See [Product Blueprint](../../docs/product/BLUEPRINT.md) for the independent core platform boundary.
