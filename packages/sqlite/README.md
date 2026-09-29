# @nublox/sqlite

`@nublox/sqlite` is the **embedded SQLite runtime of the NuBloxSQL platform**.

## Role in NuBloxSQL

The package extends NuBloxSQL into embedded databases. SQLite is an important architectural test because it has no network protocol or server session in the same sense as MySQL/PostgreSQL; it therefore proves whether the NuBloxSQL platform contracts are genuinely about database semantics rather than client/server assumptions.

## Status

| Item | Value |
| --- | --- |
| Package | `@nublox/sqlite` |
| Version | `0.1.0` |
| Status | **Development** |
| Release position | Post-v1 |
| Minimum Node.js | 22.16.0 |

SQLite is not part of the stable NuBloxSQL v1.0.0 support matrix.

## Platform contract

The adapter participates in NuBloxSQL dialect identity, capabilities, execution/results, transaction, resource-limit, error and metadata vocabulary where those concepts are meaningful for SQLite.

It intentionally does **not** claim client/server features that SQLite does not provide, such as server-side cursors or ordinary remote-query cancellation semantics.

## Native capabilities

Current development capabilities include:

- in-memory and file-backed databases;
- Node.js `node:sqlite` embedded runtime;
- prepared statements and positional/named binding;
- `BigInt` reads for SQLite INTEGER values;
- DEFERRED, IMMEDIATE and EXCLUSIVE transaction modes;
- savepoints, rollback-to-savepoint and release;
- configurable busy timeout;
- foreign-key enforcement enabled by default;
- optional query-only mode;
- row, row-byte and result-byte safety limits;
- database, table/view and column introspection;
- deterministic NuBloxSQL error classification;
- SQL Core dialect/capability compatibility.

## Quick start

```js
const sqlite = require('@nublox/sqlite');

const db = sqlite.createConnection({
  filename: ':memory:',
  readBigInts: true
});

db.exec('CREATE TABLE task(id INTEGER PRIMARY KEY, title TEXT NOT NULL)');
db.run('INSERT INTO task(title) VALUES(?)', ['first']);

const result = db.query('SELECT id, title FROM task ORDER BY id');
console.log(result.rows);

db.close();
```

## Native semantics

SQLite-specific behaviour remains adapter-owned:

- embedded rather than client/server lifecycle;
- transaction start modes;
- savepoint behaviour;
- file/storage locking;
- attached databases;
- PRAGMA-driven metadata and configuration;
- type affinity and STRICT-table semantics;
- journal/WAL/synchronous policy.

Nested `BEGIN` operations are not silently emulated. Use savepoints for nested units of work.

`transaction(fn)` is synchronous; Promise-returning callbacks are rejected so asynchronous work cannot escape an open embedded transaction.

## Development frontier

The current sequence is:

1. index, foreign-key and constraint introspection;
2. backup/serialization/restore lifecycle;
3. ATTACH/DETACH database management;
4. type-affinity and STRICT-table helpers;
5. WAL/journal/synchronous and locking policy;
6. user-defined function/aggregate policy;
7. sessions/changesets where appropriate;
8. observability and performance evidence;
9. security/configuration hardening;
10. release qualification.

The authoritative roadmap is `../../NUBLOX-SQL-ROADMAP.md`.

## Verification and dependency boundary

The package declares no third-party npm runtime, development, optional or peer dependencies. Runtime implementation uses Node.js `node:sqlite` and NuBlox-authored source.

```bash
npm run test --workspace @nublox/sqlite
```

## Related documentation

- [NuBloxSQL overview](../../README.md)
- [Design intent](../../docs/architecture/design-intent.md)
- [Multi-dialect architecture](../../docs/architecture/multi-dialect.md)
- [Roadmap](../../NUBLOX-SQL-ROADMAP.md)

## Licence

Proprietary software. Copyright (c) 2026 Stephen J T Spittal. See `LICENSE`.
