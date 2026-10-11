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
- **Syntax highlighting:** lossless, dialect-sensitive browser token colouring for keywords, strings, comments, numbers and quoted identifiers, including MySQL backticks, SQL Server brackets and PostgreSQL dollar-quoted strings. The underlying accessible textarea is the only SQL input; highlighting never transforms query text.
- **Metadata-backed SQL completion:** Ctrl+Space opens suggestions; Enter or Tab accepts, arrows navigate, Escape closes. Suggestions include SQL keywords, database tables/views and selected-table columns. Simple FROM/JOIN aliases such as `SELECT o.id FROM orders o` now resolve columns from the matching table using the current NuBloxSQL catalogue, fetched only when needed. Identifiers are quoted for the active dialect. This is not a full SQL language server.
- **SQLite optimizer plan view:** Explain plan shows native SQLite scan/search nodes and index/full-scan warnings using public `client.diagnose(sql,{analyze:false})`. It **does not execute the statement**. Other dialects do not expose this button until graphical diagnostics receive engine-specific live qualification.
- Result table, row count, command and elapsed time
- Server-side table-page limit and browser CSV export of **displayed rows only**; arbitrary SQL editor results still have a 200-row *display* cap
- Browser CSV formula neutralization for leading =, +, - and @ values
- SQLite/MySQL native arbitrary-query row and byte quotas: at most maxRows (default 200), 1 MiB total and 256 KiB per row; violations reject the query rather than truncating it
- Driver-level 15-second query timeouts and a Stop request for PostgreSQL/MySQL/SQL Server; cancellation is cooperative and must be acknowledged by the database driver
- Explicit errors and reloadable catalogues
- Same-origin, loopback-only HTTP API with an unguessable session token, CSP, no CORS or cookies
- Zero third-party dependencies; fully separate from the distributed nubloxsql package

## SQL authoring and analysis

Use **Ctrl+Space** in the query editor to see completion candidates. Typing an
identifier prefix also shows up to 12 matching candidates. The currently
selected table contributes column names; the database explorer contributes
table and view names from the connected NuBloxSQL metadata API. Identifiers are
quoted for the selected dialect. Completion does not parse join aliases,
nested scopes, stored routines or arbitrary SQL grammar; verify every query
before execution. Database metadata and the SQL text remain in the local
browser session and are not persisted by the Workbench.

On **SQLite**, enter SQL and choose **Explain plan**. Results include native
optimizer nodes and advisories for scans, indexes and temporary B-trees.
This is a non-executing compile-time plan, **not** a runtime performance
measurement; even a prepared modifying statement is **not run** by the plan
action. Optimizer plan evidence is advisory, not proof that any particular
index is beneficial. The plan endpoint is authenticated by the same
loopback-only session token; it returns only a bounded plan summary, nodes
and warnings, not the original SQL text.

## Deliberate preview limitations

This is a **single-process/single-connection developer preview**, not a published or production multi-user web service. It binds exclusively to 127.0.0.1; do not reverse-proxy, port-forward or expose it publicly. The initial browser view uses native HTML/CSS/JavaScript because it can be launched immediately without violating NuBloxSQL's zero-dependency published runtime. A separate, future **SvelteKit** frontend can consume the same local application boundary.

Table browsing now fetches at most **page size + one** records per request directly from the database, and indicates whether there is a next page. Browsing defaults to 50 rows per page, has an offset limit of 10 million, and allows sorting and **exact equality** filtering only on verified metadata columns. Filter comparisons follow the **native database type and collation semantics**, so case sensitivity and type coercion vary by dialect. Ordering by a non-unique column or changing rows concurrently can cause repeats or omissions with offset pagination; use a unique key or stable snapshot for consistency.

The arbitrary SQL editor now enforces native row and byte budgets in the
**SQLite and MySQL drivers**. Above-budget queries are rejected with an
actionable error, and partial results cannot be downloaded. These bounds are
not available yet for PostgreSQL or SQL Server arbitrary result queries:
those still have a display-only row cap, so limit result sets in SQL.

For **PostgreSQL, MySQL and SQL Server**, the local Workbench passes a 15-second
timeout and an AbortSignal to the query runtime. The Stop button requests
cancellation; it does not claim completion before the driver returns.
**SQLite uses a synchronous driver**: no Stop button or reliable wall-clock
timeout is offered, and row/byte quotas cannot interrupt CPU-bound SQL before
rows arrive. Cancellation and timeout behaviour still require live database
qualification for remote engines.

These controls do not make native SQL read-only. Always use least-privilege
database credentials and production change governance. Context-aware SQL language-server completion, graphical plans for other dialects, advanced formatting, cursor/keyset pagination, full live cancellation qualification, database profiles, settings, saved sessions, editable grids, comprehensive SQL Server catalogue parity, migration workflows, installer, backups and recoveries are not delivered here.

The browser receives **only** row data, metadata and an ephemeral API token, never full connection credentials. The local HTTP server does not persist queries, passwords, or result sets. It does not store browser history. Stop it using Ctrl+C.

## Developer qualification

~~~bash
npm run test:workbench
npm run verify
npm run release:check
~~~

The HTTP acceptance suite connects to **real Node SQLite**, verifies the demo and an existing read-only file, exercises native SQLite optimizer plans without executing modifying statements, browser completion candidate contracts, object browsing, bounded paging, column-validated sorting, parameterized filters, SQL execution, permissions, wrong-origin and missing-token requests, large inputs, native SQLite over-budget rejection, asynchronous cancellation contracts and the CLI launcher. Other engine connections use the underlying supported public API but have not yet been live-qualified through this graphical frontend.

See [Product Blueprint](../../docs/product/BLUEPRINT.md) for the independent core platform boundary.
