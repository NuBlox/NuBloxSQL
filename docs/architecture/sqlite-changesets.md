# SQLite changesets and controlled replication

NuBloxSQL exposes SQLite's session extension as an application-managed change transport. It is deliberately separate from the portable `changeDataCapture` capability: sessions capture changes only while an explicit session is open and are not a continuous database log.

## Capability detection

Use `connection.changesetCapabilities()` before relying on the session APIs. Node added `DatabaseSync.createSession()` and `DatabaseSync.applyChangeset()` during the Node 22 line, so NuBloxSQL probes the active runtime instead of version-sniffing.

The report distinguishes session/changeset/patchset support, changeset application, and conflict constants.

## Capture

`connection.createChangeSession({ database, table })` creates a scoped `ChangeSession`.

- `database` defaults to `main` and can target an attached database.
- `table` is optional; when supplied, only that table is attached to the session.
- `changeset()` returns a defensive copy of the SQLite binary changeset.
- `patchset()` returns a defensive copy of the compact SQLite patchset.
- `close()` is idempotent at the NuBloxSQL wrapper boundary.

A session records changes made after session creation. Schema must already exist on the receiving database because SQLite changesets transport row changes rather than DDL.

## Apply

`connection.applyChangeset(bytes, options)` returns a frozen result:

```js
{
  applied: true,
  conflicts: [],
  filteredTables: []
}
```

`options.filter(table)` can exclude tables from application. Excluded table names are reported in `filteredTables`.

`options.onConflict(conflict)` receives `{ code, name }`. It must return `abort`, `omit`, `replace`, or the corresponding native SQLite resolution constant. Conflict names are normalized to `data`, `notfound`, `conflict`, `constraint`, `foreign-key`, or `unknown`.

Without a conflict callback, NuBloxSQL leaves SQLite's native default in place: abort and roll back the changeset on conflict.

## Safety properties

- Input changesets are copied before native application.
- Generated changesets and patchsets are copied before return.
- Database names are validated as simple SQLite namespace identifiers.
- Table names are passed as native session options rather than interpolated into SQL.
- Unsupported runtimes fail with the stable `NUBLOXSQL_UNSUPPORTED` error path.
- User conflict callbacks are optional; default conflict behavior remains transactional abort.
- This API does not silently enable replication, background synchronization, networking, or persistence.

## Typical flow

```js
const source = sqlite.createConnection();
const target = sqlite.createConnection();

source.exec('CREATE TABLE items(id INTEGER PRIMARY KEY, value TEXT)');
target.exec('CREATE TABLE items(id INTEGER PRIMARY KEY, value TEXT)');

const session = source.createChangeSession({ table: 'items' });
source.run('INSERT INTO items(id, value) VALUES (?, ?)', [1, 'hello']);

const changes = session.changeset();
target.applyChangeset(changes);
session.close();
```

This foundation can support explicit offline sync, controlled audit/change transport, migration tooling, and higher-level replication orchestration without pretending SQLite sessions are a server-style CDC stream.
