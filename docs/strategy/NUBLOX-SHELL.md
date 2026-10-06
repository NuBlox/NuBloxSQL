# NuBlox Shell

NuBlox Shell is the terminal application built on the public NuBloxSQL platform.

## Product role

NuBlox Shell provides two complementary interfaces:

1. an interactive REPL for database engineers, developers and operators;
2. a non-interactive CLI for scripts, CI/CD and automation.

It is not a fifth database implementation. PostgreSQL, MySQL, SQLite and SQL Server behaviour remains owned by `nubloxsql`.

## Architecture invariant

```text
NuBlox Shell
    |
    v
public nubloxsql API
    |
    +-- PostgreSQL
    +-- MySQL
    +-- SQLite
    +-- SQL Server
```

Production Shell code must not import `lib/client`, `lib/dialects`, `lib/capabilities`, or other NuBloxSQL internals. If Shell needs a capability that is absent from the public API, the platform API must be improved first.

## v0.1 foundation

The initial shell provides:

- `nublox` executable;
- interactive REPL;
- multi-line native SQL execution;
- one-shot `--execute` and `--command` automation;
- table, JSON, JSONL and CSV output;
- connection summary with credential redaction;
- server discovery;
- database/catalog listing;
- schema and table browsing;
- table description;
- configuration discovery;
- repository-local development resolution while still consuming only the public NuBloxSQL entry point.

## Command namespace

NuBlox commands use a backslash prefix so native SQL remains native SQL:

```text
\help
\connection
\server
\databases
\schemas
\tables
\describe
\config
\format
\quit
```

## Next increments

The next Shell slices should expose existing NuBloxSQL lifecycle contracts rather than inventing new database logic:

1. configuration plan/inspect/apply;
2. schema snapshots and diffs;
3. migration planning/execution;
4. diagnostics and dependency inspection;
5. script/file execution and history;
6. secure named connection profiles;
7. completion and context-aware help;
8. operational health/session/maintenance commands as NuBloxSQL gains those APIs.

Machine-readable output remains a first-class requirement for every command intended for automation.
