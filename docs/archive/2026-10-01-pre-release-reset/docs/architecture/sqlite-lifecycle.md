# SQLite lifecycle and attached databases

NuBloxSQL exposes SQLite lifecycle features through the native SQLite connection while keeping the portable root client API unchanged.

## Open modes

SQLite connections accept `mode`:

- `readwrite-create` (default) — open read/write and create the file when needed;
- `readwrite` — require an existing database file and open read/write;
- `readonly` — use SQLite's native read-only open mode.

`open: false` defers opening until `connection.open()` is called. `queryOnly: true` is separate from native read-only mode and applies `PRAGMA query_only = ON` after opening.

## Attached databases

`connection.attach(filename, name)` and `connection.detach(name)` expose SQLite `ATTACH DATABASE` / `DETACH DATABASE` with validated namespace identifiers. Attached names are visible in `listDatabases()` and can be supplied as `database`/`schema` to NuBloxSQL metadata calls:

```js
client.native.attach(':memory:', 'archive');
await client.execute('CREATE TABLE archive.audit(id INTEGER PRIMARY KEY)');
const tables = await client.catalog.tables({ database: 'archive' });
```

The catalog therefore treats SQLite attached database names as SQLite namespaces without claiming that SQLite implements server-style schemas.

## Backup

`connection.backup(destination, options)` wraps Node's `node:sqlite` backup API. It is asynchronous and supports `source`, `target`, `rate`, and `progress`. Backup is available throughout NuBloxSQL's supported Node 22/24/26 range.

## Serialization

`connection.serialize(database?)` and `connection.deserialize(buffer, options?)` are capability-detected because Node introduced these APIs after the original Node 22 SQLite surface. Use `connection.lifecycleCapabilities()` before depending on them in code that must run on every supported Node release.

On unsupported runtimes, serialization methods fail deterministically with `SqliteError` category `unsupported` and code `NUBLOXSQL_UNSUPPORTED`.

## Safety

- database namespace names must be simple SQL identifiers;
- `main` and `temp` cannot be detached;
- `readwrite` mode does not create a missing file;
- read-only mode delegates enforcement to SQLite's native read-only open flag;
- attached database metadata remains explicitly scoped by namespace.
