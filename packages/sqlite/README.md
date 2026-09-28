# @nublox/sqlite

`@nublox/sqlite` is the embedded SQLite adapter for NuBloxSQL.

The initial `0.1.x` line is a post-v1 development package built on Node.js `node:sqlite`. It introduces no third-party npm dependency and preserves the NuBloxSQL separation between portable SQL contracts and database-specific runtime semantics.

## Runtime model

SQLite is embedded rather than client/server. The adapter therefore exposes a synchronous connection model around `DatabaseSync` and does not claim server-side capabilities that SQLite does not have.

Current foundation capabilities include:

- in-memory and file-backed databases;
- prepared statements and positional/named binding;
- JavaScript `BigInt` reads for SQLite INTEGER values;
- DEFERRED, IMMEDIATE and EXCLUSIVE transaction starts;
- savepoints, rollback-to-savepoint and release;
- configurable busy timeout;
- foreign-key enforcement enabled by default;
- optional query-only mode;
- row, row-byte and total-result-byte safety limits;
- database, table/view and column introspection;
- deterministic NuBloxSQL error classification;
- SQL Core dialect descriptor and capability reporting.

## Requirements

- Node.js 22.16.0 or later.

The minimum is intentional because this adapter uses the Node 22.16 SQLite metadata and transaction-state APIs.

## Example

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

SQLite supports one simultaneous write transaction per database. `begin()` accepts `deferred`, `immediate` or `exclusive`, matching SQLite transaction modes. Nested `BEGIN` calls are not emulated; use `savepoint()`, `rollbackTo()` and `release()` for nested units of work.

`transaction(fn)` is synchronous. Returning a Promise from the callback is rejected so a transaction cannot accidentally remain open while asynchronous work escapes the embedded database operation.

## Result limits

`query()` accepts:

- `maxRows`;
- `maxRowBytes`;
- `maxResultBytes`.

Exceeding a configured limit throws `SqliteResultLimitError` with category `resource-limit`.

## Status

This package is the A3 SQLite foundation. The next SQLite slices should add deeper index/foreign-key introspection, backup/serialization lifecycle operations, attached-database management, type-affinity helpers, WAL/locking policy, observability and performance evidence.

## Licence

Proprietary software. See `LICENSE`.
