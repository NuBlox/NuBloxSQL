# Prepared server-side cursors

NuBloxSQL supports MySQL read-only server-side cursors for prepared result sets. The implementation uses `CURSOR_TYPE_READ_ONLY` on `COM_STMT_EXECUTE`, retains the returned result metadata, and retrieves binary rows in bounded batches with `COM_STMT_FETCH`.

## Callback API

```js
connection.openCursor(
  'SELECT id, name FROM users WHERE id > ? ORDER BY id',
  [1000],
  {fetchSize: 250},
  function (error, cursor) {
    if (error) throw error;

    cursor.fetch(function (fetchError, rows, state) {
      if (fetchError) throw fetchError;

      console.log(rows);
      console.log(state.done);
      cursor.close();
    });
  }
);
```

`cursor.fetch()` uses the configured `fetchSize`, defaulting to 100 rows. A positive explicit row count may be supplied as the first argument. Fetch sizes are validated against the unsigned 32-bit `COM_STMT_FETCH` field.

The cursor exposes `fields`, `statementId`, `done`, and `closed`. `done` becomes true when MySQL reports `SERVER_STATUS_LAST_ROW_SENT`.

## Promise API

```js
const connection = mysql.createConnection(config);
await connection.connect();

const cursor = await connection.openCursor(
  'SELECT id, name FROM users ORDER BY id',
  [],
  {fetchSize: 250}
);

const batch = await cursor.fetch();
console.log(batch.rows, batch.done, batch.fields);

await cursor.close();
```

Promise cursors implement the async-iterator protocol, so rows can also be consumed progressively:

```js
for await (const row of cursor) {
  console.log(row);
}

await cursor.close();
```

## Resource and connection semantics

A MySQL server cursor belongs to one physical prepared statement on one physical connection. NuBloxSQL therefore exposes cursor creation on connections, not directly on pools. Applications using a pool should acquire a connection, keep it checked out for the entire cursor lifetime, close the cursor, and only then release the connection.

Each fetched batch reuses the driver's binary-row decoder and existing row/result resource limits. Cursor opening also applies the existing result-column and metadata bounds.

Closing a cursor sends `COM_STMT_CLOSE`, which also releases the underlying prepared statement on the server. A cursor should always be closed when no longer needed, including after iteration completes.
