# NuBlox Shell

NuBlox Shell is the terminal interface for NuBloxSQL. It intentionally contains no database-engine implementation; commands use the public `nubloxsql` API.

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
