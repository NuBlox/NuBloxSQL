# SQLite production service

**Scope:** SQLite-native recipe using NuBloxSQL's embedded `node:sqlite` runtime.

SQLite is not a client/server database, so production concerns are file ownership, journal mode, busy handling, integrity, backup and process-level concurrency rather than network pooling.

## Open with an explicit storage policy

```js
const { createConnection } = require('nubloxsql');

const db = createConnection('sqlite', {
  filename: 'app.db',
  open: false,
  productionDefaults: true,
  journalMode: 'wal',
  synchronous: 'normal',
  busyTimeout: 5_000,
  walAutoCheckpoint: 1_000,
  foreignKeys: true
});

db.open();
```

Use one clearly owned connection per application responsibility. WAL improves reader/writer concurrency, but it does not turn SQLite into a remote multi-node database.

## Schema and prepared work

```js
db.exec(`
  CREATE TABLE IF NOT EXISTS jobs (
    id INTEGER PRIMARY KEY,
    state TEXT NOT NULL,
    payload TEXT NOT NULL
  )
`);

const insert = db.prepare(
  'INSERT INTO jobs (id, state, payload) VALUES (?, ?, ?)'
);

for (let id = 1; id <= 1000; id += 1) {
  insert.run([id, 'pending', JSON.stringify({ id })]);
}
```

For bulk writes, wrap repeated prepared executions in an explicit transaction so each row is not committed independently.

```js
db.begin('immediate');
try {
  for (const job of jobs) {
    insert.run([job.id, job.state, JSON.stringify(job.payload)]);
  }
  db.commit();
} catch (error) {
  db.rollback();
  throw error;
}
```

## Checkpoint WAL

```js
const checkpoint = db.checkpoint('passive');
console.log(checkpoint.busy, checkpoint.logFrames, checkpoint.checkpointedFrames);
```

A busy checkpoint can be normal while readers retain older snapshots. Do not treat every non-zero `busy` result as corruption.

## Integrity and foreign-key checks

```js
const integrity = db.integrityCheck({ maxErrors: 20 });
if (!integrity.ok) {
  console.error(integrity.messages);
  throw new Error('SQLite integrity check failed');
}

const foreignKeys = db.foreignKeyCheck();
if (!foreignKeys.ok) {
  console.error(foreignKeys.violations);
}
```

Run integrity checks on an operational schedule appropriate to the application and backup strategy. A failed integrity check is not something to auto-repair blindly.

## Backup

```js
const pages = await db.backup('backups/app.db', {
  source: 'main',
  rate: 100,
  progress(status) {
    console.log(status.remainingPages, status.totalPages);
  }
});

console.log(`backup complete; copied ${pages} pages`);
```

Backups must themselves be retained, rotated and tested for restoreability outside the database process.

## Optimize and vacuum

```js
const optimization = db.optimize();
console.log(optimization.native);
```

Use `vacuum()` only with an operational reason and enough free disk/time for the operation. Do not schedule aggressive maintenance simply because the API exists.

## Planner diagnostics

```js
const diagnosis = db.diagnoseQuery(
  'SELECT id, state FROM jobs WHERE state = ? ORDER BY id',
  ['pending'],
  { includeOpcodes: false }
);

console.log(diagnosis.plan.summary);
console.log(diagnosis.plan.warnings);
```

## Shutdown

```js
try {
  db.checkpoint('truncate');
} finally {
  db.close();
}
```

A truncating checkpoint can be inappropriate if other active connections still depend on the WAL. Coordinate shutdown ownership rather than forcing maintenance from arbitrary request handlers.

See the [SQLite dialect guide](../guides/10-dialects.md) and [production operation](../guides/13-production-and-troubleshooting.md).
