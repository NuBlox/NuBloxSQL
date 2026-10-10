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

## Operational session correctness

Session controls are implemented in `apps/shell/lib/Shell.js` and the
public-API-only command router:

- `\\status`, `\\disconnect` and `\\reconnect` allow a database session to
  be inspected and reopened without restarting the Shell.
- An explicit `\\reset` discards a partially entered multi-line statement.
- `\\history on|off|clear` is opt-in, in-memory only, capped at 50 records,
  and disabled by default to avoid accidental recording of SQL literals.
- Non-interactive REPL sessions fail with nonzero exit status if SQL fails,
  input exceeds the 1 MiB statement cap or EOF contains unfinished SQL;
  interactive sessions can continue after errors.

None of these controls persists connection credentials or SQL history to disk.
Reconnect operates only within the same running process.

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
\status
\disconnect
\reconnect
\history
\reset
\quit
```

## End-to-end lifecycle command direction

NuBlox Shell should expose the public NuBloxSQL lifecycle progressively rather than inventing database logic inside the CLI.

Directional command families:

```text
select       -> \engine select, \engine catalog
install      -> \engine install inspect|plan|apply
initialize   -> \engine initialize inspect|plan|apply
discover     -> \server, \databases, \schemas, \tables, \describe
establish    -> \config, \security, \bootstrap
build        -> native SQL, \migration, \seed
use          -> native SQL, transactions, scripts
understand   -> \describe, \dependencies, \diagnose, \snapshot
operate      -> \health, \sessions, \locks, \maintenance, \backup, \restore
change       -> \diff, \migration, \config, \engine upgrade
retire       -> \retire inspect|plan|apply, \engine uninstall
```

These names are directional until corresponding public APIs exist.

The Shell must not implement package-manager commands, SQL Server Setup semantics, PostgreSQL cluster initialization, MySQL upgrade rules or SQLite file-lifecycle behaviour directly. Those capabilities belong in NuBloxSQL engine-lifecycle APIs and installation providers; Shell only renders and invokes those public contracts.

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
