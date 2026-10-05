# Database configuration discovery

NuBloxSQL configuration discovery is the first released slice of the **administration.configuration** lifecycle area.

The goal is to answer a simple but critical question before configuration automation is introduced:

> What configuration exists on this engine, what is its current value, where does it apply, and what evidence do we have about changing it?

NuBloxSQL keeps engine-native differences visible. It does not pretend that PostgreSQL GUCs, MySQL system variables, SQLite PRAGMAs and SQL Server configuration options share identical lifecycle semantics.

## Discover configuration

```js
const report = await db.discoverConfiguration();
```

The root API is equivalent:

```js
const report = await sql.discoverDatabaseConfiguration(db);
```

A report contains:

```text
schemaVersion
dialect
settings[]
summary
```

Each setting contains:

```text
name
value
scope
apply
mutable
restartRequired
source
description
native
```

The complete source row is retained under `native` so the normalized contract never discards engine-specific evidence.

## Find one setting

```js
const report = await db.discoverConfiguration();

const setting = sql.findDatabaseConfiguration(
  report,
  'shared_buffers'
);
```

Name lookup is case-insensitive.

## Apply modes

NuBloxSQL currently uses these normalized apply modes:

| Apply mode | Meaning |
| --- | --- |
| `immediate` | The discovered engine evidence indicates the setting can take effect without a reload/restart boundary. |
| `reload` | A configuration reload boundary is required. |
| `restart` | A server/service restart boundary is required. |
| `new-session` | Existing sessions are not the correct application boundary; a new session/connection is required. |
| `immutable` | The discovered setting is not runtime-changeable through the relevant engine configuration mechanism. |
| `unknown` | The discovery source does not provide enough evidence for NuBloxSQL to make a stronger claim. |

`unknown` is deliberate. NuBloxSQL does not infer mutability merely because a setting is visible.

## Scope

Normalized scope values are:

```text
server
database
session
connection
unknown
```

These are lifecycle/administration scopes, not a claim that every engine supports the same hierarchy.

## PostgreSQL

PostgreSQL discovery reads `pg_settings`.

This provides unusually rich evidence, including:

- current setting;
- unit;
- category;
- description;
- context;
- source;
- boot/reset values;
- pending-restart evidence.

NuBloxSQL maps PostgreSQL contexts conservatively:

- `internal` → `immutable`;
- `postmaster` → `restart`;
- `sighup` → `reload`;
- `backend` / `superuser-backend` → `new-session`;
- `user` / `superuser` → `immediate`.

The original `pg_settings` row remains in `native`.

## MySQL

MySQL discovery currently uses:

```sql
SHOW GLOBAL VARIABLES
```

This gives broad server-variable coverage and current global values.

The first discovery contract intentionally reports:

```text
scope: server
apply: unknown
mutable: null
restartRequired: null
```

unless stronger evidence is available in a future qualification layer.

This avoids treating visibility as proof that a variable is dynamic, persistable or restart-bound.

The next MySQL configuration slice should combine version-qualified metadata from Performance Schema and official variable semantics before enabling automatic change planning.

## SQL Server

SQL Server discovery reads `sys.configurations`.

NuBloxSQL retains:

- configured value;
- value in use;
- minimum/maximum;
- dynamic flag;
- advanced flag;
- description.

A dynamic configuration is normalized as `immediate`. A non-dynamic configuration is represented as restart-bound by this first contract.

The complete `sys.configurations` row remains available under `native`.

## SQLite

SQLite has no server configuration catalog.

NuBloxSQL therefore exposes a curated read-only PRAGMA configuration view rather than pretending SQLite has server variables.

The initial set includes:

```text
foreign_keys
journal_mode
synchronous
busy_timeout
cache_size
temp_store
locking_mode
auto_vacuum
wal_autocheckpoint
mmap_size
page_size
```

The contract distinguishes connection-scoped from database-scoped PRAGMAs where defensible.

Some SQLite settings such as `page_size` and `auto_vacuum` have lifecycle constraints that cannot be reduced safely to a simple immediate/restart model, so their apply mode remains `unknown`.

## Current boundary

This release provides **discovery plus immutable change planning**.

Use discovery evidence to create a deterministic plan:

```js
const discovered = await db.discoverConfiguration();

const plan = db.planConfiguration(discovered, {
  changes: [
    { name: 'work_mem', value: '8192' }
  ]
});
```

Plans expose immutable steps, a SHA-256 plan hash, automatic/manual/satisfied classification, native SQL where safe, and explicit requirements for privileges, transaction boundaries, reload, restart and reconnect.

PostgreSQL plans use `ALTER SYSTEM` and model `pg_reload_conf()` or a manual restart boundary from the discovered context. SQL Server plans use `sys.sp_configure` plus `RECONFIGURE`, with non-dynamic settings followed by a manual restart boundary. Safe SQLite PRAGMAs are rendered directly; lifecycle-sensitive PRAGMAs remain manual. MySQL changes remain manual until NuBloxSQL has stronger variable-specific evidence for dynamic/persistible semantics.

It does not yet:

- execute configuration change plans;
- automatically choose `SET GLOBAL`, `SET PERSIST` or `SET PERSIST_ONLY` for MySQL;
- edit PostgreSQL configuration files directly;
- restart database services;
- claim privilege availability;
- modify operating-system, cloud or container configuration.

That separation is intentional.

The next configuration slice should introduce controlled **plan execution** with:

- dry-run;
- explicit approval gates;
- manual-step handlers;
- pre-execution rediscovery/drift checks;
- controlled native SQL execution;
- reload handling;
- post-change verification;
- restart-boundary reporting;
- audit output.

Service restarts must remain explicit/manual unless a future execution environment can prove ownership of that lifecycle boundary.
