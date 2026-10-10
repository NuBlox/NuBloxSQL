# NuBlox Shell

NuBlox Shell is the terminal interface for NuBloxSQL. It intentionally contains no database-engine implementation; commands use the public `nubloxsql` API.

## Working today: quick start from the repository

From the NuBloxSQL repository root, on Node.js 22 or later:

```bash
node apps/shell/bin/nublox.js --demo --format json
node apps/shell/bin/nublox.js --doctor --format json
npm run smoke
```

`--demo` creates a **temporary, in-memory SQLite database**, inserts two
example records, queries them and inspects its tables. It never touches your
existing database or the configured `NUBLOX_DATABASE_URL`.

`--doctor` validates both a query and database-server discovery; without
connection settings it self-tests against in-memory SQLite. To check a
database that you actually intend to use, supply your normal connection
options, for example:

```bash
node apps/shell/bin/nublox.js --dialect sqlite --filename ./my-existing.sqlite --doctor --format json
```

Non-SQLite installations can use their existing `--url` or
`--dialect`/`--host`/`--user`/`--database` settings instead.
The doctor exits with status **0** only if the query and discovery pass,
**1** on runtime/connection failure, and **2** on invalid CLI options.
It does not change database schema or content.

The `npm run smoke` acceptance suite runs the real Shell executable
against both in-memory and file-backed SQLite, including SQL queries,
catalogue browsing, table descriptions, interactive input and failure cases.
It does **not** qualify connectivity to your remote PostgreSQL, MySQL or
SQL Server instances; those require reachable databases and credentials.

## Install

```bash
npm install -g @nublox/shell
```

Then:

```bash
nublox --url "$NUBLOX_DATABASE_URL"
```

For discrete connection settings:

```bash
export NUBLOX_PASSWORD='...'
nublox --dialect postgresql --host 127.0.0.1 --port 5432 --user app --database app
```

Avoid putting passwords directly into shell history. Prefer environment/secret injection.

## Interactive commands

```text
\help
\connection
\server
\databases
\schemas [database]
\tables [schema]
\describe <table>
\config [setting]
\format table|json|jsonl|csv
\quit
```

Any non-command input is sent as native SQL through `Client.query()`. Multi-line SQL is accumulated until a line ends with `;`.

## SQL files and CSV/JSON export

For a single native SQL statement saved in `query.sql`, use standard
input/output redirection rather than granting NuBloxSQL direct file-path
access. The command accepts up to 1 MiB of SQL:

```bash
node apps/shell/bin/nublox.js --dialect sqlite --filename ./database.sqlite \
  --stdin --format csv < query.sql > results.csv
```

Change `--format csv` to `json`, `jsonl` or `table` as required.

**Warning:** `>` can overwrite an existing output file. On macOS using
zsh, run `setopt noclobber` first to refuse overwrites, or select a
new results filename. The database driver itself does not write output files.

`--stdin` executes **one** dialect-native SQL statement. It does not
interpret migration scripts or split multiple statements. For commands
and multiple interactive statements, use the existing REPL. Native SQL
can change a connected database: use a suitably restricted database user
for inspection-only workflows.

## Automation

```bash
nublox --url "$NUBLOX_DATABASE_URL" --execute "SELECT 1" --format json
nublox --url "$NUBLOX_DATABASE_URL" --command "\tables" --format csv
```

The shell supports `table`, `json`, `jsonl`, and `csv` output modes.

## Architecture rule

```text
NuBlox Shell
    ↓
public nubloxsql API
    ↓
supported database engines
```

The shell must not import NuBloxSQL dialect internals. If a command needs missing engine behaviour, that behaviour belongs in the public NuBloxSQL platform first.
