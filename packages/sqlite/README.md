# @nublox/sqlite

Embedded SQLite adapter for NuBloxSQL.

## Status

- Package: `@nublox/sqlite`
- Version: `0.1.0`
- Status: **Development**
- NuBloxSQL baseline: **Post-v1**
- Minimum Node.js: **22.16.0**

SQLite is not part of the stable NuBloxSQL v1.0.0 support matrix.

## Runtime model

SQLite is embedded rather than client/server. The adapter uses Node.js `node:sqlite` and exposes a synchronous database lifecycle around `DatabaseSync`.

## Current capabilities

- in-memory and file-backed databases;
- prepared statements and positional/named binding;
- `BigInt` reads for SQLite INTEGER values;
- DEFERRED, IMMEDIATE and EXCLUSIVE transaction modes;
- savepoints, rollback-to-savepoint and release;
- configurable busy timeout;
- foreign-key enforcement enabled by default;
- optional query-only mode;
- row, row-byte and result-byte limits;
- database, table/view and column introspection;
- deterministic NuBloxSQL error classification;
- SQL Core dialect descriptor compatibility.

The adapter deliberately does not claim client/server features such as native query cancellation or server-side cursors.

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

## Transaction semantics

`begin()` accepts `deferred`, `immediate` or `exclusive`. Nested `BEGIN` operations are not emulated; use savepoints for nested units of work.

`transaction(fn)` is synchronous. Promise-returning callbacks are rejected so asynchronous work cannot escape an open embedded transaction.

## Development frontier

The authoritative sequence is maintained in `../../NUBLOX-SQL-ROADMAP.md`. The next slice is index, foreign-key and constraint introspection, followed by backup/restore lifecycle, attached-database management, type-affinity/STRICT helpers and storage/locking policy.

## Dependency boundary

The package declares no third-party npm runtime, development, optional or peer dependencies. Runtime implementation uses Node.js `node:sqlite` and NuBlox-authored source.

## Related documentation

- `../../README.md`
- `../../docs/architecture/multi-dialect.md`
- `../../NUBLOX-SQL-ROADMAP.md`

## Licence

Proprietary software. Copyright (c) 2026 Stephen J T Spittal. See `LICENSE`.
