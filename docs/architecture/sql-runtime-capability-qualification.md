# Tier-1 Runtime Capability Qualification

## Purpose

M6 resolves the static PostgreSQL, MySQL and SQLite capability model against the actual connected database/runtime without converting uncertain capabilities into guesses.

## Public API

```js
const staticReport = sql.capabilityModel.qualify('sqlite', {
  version: '3.49.1',
  features: {
    'expressions.json': true,
    'extensions.fts5': true
  }
});

const liveReport = await sql.capabilityModel.qualifyClient(client);
```

`qualify()` accepts supplied evidence. `qualifyClient()` gathers live version evidence from the connected Tier-1 client and, for SQLite, reuses NuBloxSQL runtime probes already exposed by the native adapter.

## Resolution rules

1. Statically native/equivalent/emulated/partial/unsupported/not-applicable features remain resolved from the exhaustive-v1 model.
2. `runtime-version` features are resolved only when the connected version can be compared with the documented `since` version.
3. `runtime-probe`, `runtime-compile-option`, host-runtime and connection-setting capabilities remain unresolved unless direct evidence is available.
4. Explicit runtime probes override version inference for the exact capability path they qualify.
5. Reports preserve the original static feature alongside the runtime resolution.
6. No compatibility percentage or automatic migration verdict is produced.

## Live engine version discovery

- PostgreSQL: `SHOW server_version`
- MySQL: `SELECT VERSION() AS version`
- SQLite: `SELECT sqlite_version() AS version`

## SQLite direct evidence

When available, M6 consumes existing NuBloxSQL SQLite probes for:

- JSON / JSONB
- FTS5
- STRICT tables
- RETURNING
- window functions
- custom collations
- authorizer support
- defensive mode
- extension loading
- session changesets
- foreign-key enforcement for the active connection

This is deliberately more conservative than assuming every feature introduced before the SQLite library version is usable in the active build.

## Report shape

Each report contains the detected version, source, summary counts and a deeply frozen entry for every modeled capability. Entries identify whether they were resolved statically, by runtime version, or by direct runtime probe. Unresolved entries retain `supported: null`.

## M6 boundary

M6 supplies trustworthy runtime evidence to M5 compatibility analysis. It does not rewrite SQL. M7 will consume these qualified capabilities when planning safe rewrites and compatibility transformations.
