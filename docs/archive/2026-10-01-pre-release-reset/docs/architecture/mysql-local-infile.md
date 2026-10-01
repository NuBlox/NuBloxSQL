# MySQL LOAD DATA LOCAL INFILE

## Purpose

NuBloxSQL implements MySQL `LOAD DATA LOCAL INFILE` as an explicitly enabled, client-supplied streaming operation. The design deliberately avoids exposing a generic server-directed filesystem read primitive.

## Security boundary

`CLIENT_LOCAL_FILES` is advertised only when the connection is created with `localInfile: true`.

A normal `query()` call will reject a MySQL LOCAL INFILE request even when the connection has negotiated the capability. LOCAL INFILE data is accepted only through `connection.loadDataLocal()` or `pool.loadDataLocal()`.

The server-requested filename must exactly match `options.filename`. A mismatch destroys the connection and rejects the operation.

NuBloxSQL does not accept filesystem paths as LOCAL INFILE sources and never opens a filename supplied by the MySQL server. Applications that intentionally load a local file must open their own readable/async-iterable source and pass that source to NuBloxSQL. This keeps filesystem policy, symlink handling and application-specific path allowlisting outside the database protocol boundary.

## API

```js
const connection = mysql.createConnection({
  ...config,
  localInfile: true
});

await connection.connect();

const result = await connection.loadDataLocal(
  "LOAD DATA LOCAL INFILE 'import.csv' INTO TABLE target FIELDS TERMINATED BY ','",
  source,
  {
    filename: 'import.csv',
    maxBytes: 64 * 1024 * 1024,
    timeout: 15000
  }
);
```

`source` may be a string, `Buffer`, `Uint8Array`, iterable, async iterable, or Node readable stream yielding those chunk types.

## Resource governance

- default maximum upload size: 64 MiB;
- default client packet chunk size: 64 KiB;
- socket backpressure is observed before advancing the source iterator;
- timeout and abort signals destroy the physical connection to terminate the in-flight server request deterministically;
- exceeding `maxBytes` destroys the connection rather than sending a truncated file that could be mistaken for a successful import.

Both defaults are configurable per connection and may be overridden per operation.

## Pool semantics

`pool.loadDataLocal()` acquires one physical MySQL session for the entire upload. The connection is returned to the pool only after the server has completed the statement and the existing pool reset policy has been applied. Failed operations that destroy the connection are removed from the pool rather than reused.

## Qualification

The MySQL workflow qualifies:

- Node.js 22, 24 and 26 contract coverage;
- live MySQL 8.4;
- live MySQL 9.7;
- inline and async-iterable uploads;
- pool reuse;
- exact filename enforcement;
- rejection of LOCAL INFILE through ordinary `query()`;
- byte-limit failure safety;
- existing transaction, streaming, cancellation, error, release and security regressions.
