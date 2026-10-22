# @nublox/driver — first native MySQL slice

**Experimental — not production qualified.** This is an independently consumable first-party MySQL Classic protocol client. It is not a universal SQL implementation, full SQL:2023 support or a multi-vendor release.

## Example

```js
import {connectDatabase} from '@nublox/driver';
const db = await connectDatabase({
  engine: 'mysql',
  host: '127.0.0.1', port: 3306,
  user: 'myuser', password: process.env.MYSQL_PASSWORD,
  database: 'mydb',
  security: 'verified-tls',
  ca: process.env.MYSQL_CA_PEM,
  serverName: 'localhost'
});
try {
  const result = await db.query('SELECT ? AS label, ? AS amount', ['example', 10]);
  console.log(result.rows);
  await db.transaction(async tx => {
    await tx.query('UPDATE accounts SET amount = amount + ? WHERE id = ?', [5, 1]);
  });
} finally {await db.close();}
```

The `ca` option is a PEM certificate **string**, not a file path. `serverName` specifies the expected certificate identity when it differs from the TCP address. Verified TLS requires a valid certificate and matching server identity. Unencrypted `isolated-local` is restricted to literal `127.0.0.1` or `::1` endpoints and is **not** an appropriate production remote deployment.

Native bound parameters: null, boolean, UTF-8 string, binary Uint8Array, finite number (safe integer or double) and 64-bit bigint. Values are never interpolated into user SQL. Results are limited to 10,000 rows or 8 MiB. Transactions use the callback-scoped `tx.query` method, not the parent session.

### Lossless result shape and duplicate SQL aliases

MySQL permits multiple projected expressions with the same name, including joins
that return two `id` columns. JavaScript object keys alone cannot represent
this faithfully. For row-producing queries, NuBloxSQL now exposes:

```js
const result=await db.query('SELECT ? AS id, ? AS id',[12,34]);
result.columns.map(c=>c.name);    // ['id','id'] — original server names
result.columnKeys;                // ['id','id#2'] — unique stable object keys
result.rowValues;                 // [[12n,34n]] — full positional rows
result.rows[0].id;                // 12n
result.rows[0]['id#2'];           // 34n
```

- `columns[i]` and `rowValues[row][i]` always refer to the **same ordinal**; this is the canonical lossless representation. Column metadata also preserves `originalName` and `originalTable`, which are distinct from query aliases.
- `rows` remains a convenient dictionary of values. For duplicate names, the first keeps the original name and later names use `#2`, `#3` etc. Existing aliases (including `id#2`) are reserved so generated names never overwrite them. `columnKeys` gives the exact keys, in column order.
- Every row object has a null prototype. Literal column names such as `__proto__` cannot manipulate object prototypes.
- For statements without row sets (DML/DDL), `rowValues` and `columnKeys` are not present. Existing callers that use unique column names and `result.rows` remain source-compatible.
- The parser validates MySQL ColumnDefinition41 and EOF packets and rejects unsupported `SERVER_MORE_RESULTS_EXISTS` and stored-procedure OUT-parameter result boundaries. A failed protocol boundary closes the native session rather than returning an incomplete result.

### Binary result data fidelity

- Signed/unsigned TINYINT, SMALLINT, INT and BIGINT respect native width. BIGINT values are returned as **bigint**, not lossy JavaScript numbers.
- DECIMAL/NEWDECIMAL retain exact digits and scale as **strings**, including negative and very large values. FLOAT/DOUBLE use JavaScript numbers.
- TEXT and BLOB can share MySQL type codes: the native output collation (63 means binary) differentiates **string** from **Buffer**. VARCHAR/VARBINARY and CHAR/BINARY follow the same rule. BIT and GEOMETRY are raw **Buffer** bytes.
- JSON is returned as a **serialized JSON string**, not implicitly parsed into a JavaScript object, so consumers control number precision and validation.
- DATE, DATETIME, TIMESTAMP and TIME remain **strings** and preserve six-digit fractional seconds where declared. TIME durations may be negative or exceed 24 hours; DATETIME is not assigned an artificial timezone. TIMESTAMP reflects the server session's configured timezone; consumers should set it explicitly when reproducible UTC representation is required. Zero dates remain representable as strings.
- UTF-8 MySQL collations, ASCII and known MySQL latin1/Windows-1252 collations are supported. Other collation IDs **fail closed** rather than silently misdecode bytes. Comprehensive international character-set support and future vendor types remain unqualified.
- Invalid native type codes, unexpected NULL markers, malformed binary rows and invalid temporal lengths are rejected rather than silently converted. This may terminate the affected session to avoid protocol desynchronisation.

Live MySQL 8.4.11 tests cover exact decimals, signed and unsigned extremes, TEXT/BLOB, JSON, BIT, Unicode text, leap-day dates, negative TIME(6), DATETIME(6) and TIMESTAMP(6), plus text/binary/decimal results over verified TLS.

Supported experimental authentication plugins: `caching_sha2_password` (default MySQL 8.4) and `mysql_native_password` where the server enables it. Unencrypted RSA password exchange, compression, multiple results, cursor streaming, cloud IAM, cancellation **without closing the connection**, automated reconnect and non-SQL operations **are not supported**.

## Cancellation, deadlines and resource ownership

The public relational session accepts an optional third argument on `query(sql, parameters, options)`, and a second argument on `transaction(callback, options)`:

```js
const controller=new AbortController();
const pending=db.query('SELECT SLEEP(5)',[],{signal:controller.signal,timeoutMs:2000});
// Abort the current command if the result is no longer needed:
controller.abort();
try {await pending;}catch(error) {
  if(error.code!=='CANCELLED')throw error;
}
```

- **Before execution:** an already-aborted or queued-and-cancelled operation fails with `CANCELLED` without sending SQL; the session remains usable.
- **During execution:** cancellation or deadline expiry aborts the native socket, fails with `CANCELLED` or `TIMEOUT`, and marks the session closed. Do **not** reuse that session; create a new verified connection. There is no unverified same-session protocol cancellation or automatic replay.
- **Timeout:** `timeoutMs` must be 100–120,000 ms; it defaults to the connection's timeout. The budget starts when a queued command gets the session. Invalid options reject with `INVALID_INPUT` without affecting the connection.
- **Closing:** `close()` immediately closes the native socket and fails running or queued commands with `CONNECTION_CLOSED`; it does not wait indefinitely for a server command. Calling `close()` again is safe. Shutdown is intentionally immediate rather than promising graceful server-side `COM_QUIT` when work is active.
- **Transactions:** the transaction-level signal and deadline cover the callback. Cancellation during a transaction disconnects rather than claiming a confirmed rollback; the caller must verify the outcome before retrying potentially non-idempotent writes. Normal application callback failures still roll back and leave a healthy connection usable.
- **Scope:** AbortSignal stops database I/O; it cannot forcibly terminate unrelated user JavaScript already running inside a transaction callback.

The CI suite verifies these states using real MySQL 8.4.11 instances, including TLS-connected cancellation and a fresh authenticated reconnection. Advanced pooling policies, server-side kill/cancel, and independent per-query cancellation inside transactions are outside the current release scope.

## Reusable server-prepared statements (experimental)

```js
const statement=await db.prepare('SELECT ? AS value');
try{
  const first=await statement.execute([10]);
  const second=await statement.execute([20]);
  console.log(first.rows,second.rows);
} finally {
  await statement.close();
}
```

- `prepare(sql, options?)` uses MySQL's native `COM_STMT_PREPARE` exactly once, exposing `parameterCount` and returning a connection-owned `RelationalPreparedStatement`. Every `execute(parameters?, options?)` sends a native `COM_STMT_EXECUTE` with fresh bound values and supports the same cancellation/deadline rules as `query()`.
- `close()` sends native `COM_STMT_CLOSE` and is idempotent. A closed statement cannot execute. Closing a connection or resetting it for pooled reuse invalidates **all** outstanding statement handles. Statement handles cannot be transported to another connection.
- `query()` remains the one-shot convenience API and prepares/executes/closes on every call. Use `prepare()` when you intend to execute the same statement repeatedly.
- Each connection permits at most **128 simultaneously open reusable statements**. Explicitly close them to reclaim server resources; there is no implicit LRU cache, cross-connection cache, streaming cursor or stored-procedure multi-result support.
- In `pool.withConnection()`, a borrowed statement must be prepared, used and (where practical) closed **inside its callback**. Escaped statement wrappers are revoked when the lease ends. The MySQL pool reset also frees server-side prepared state before lending the connection again.
- Invalid parameter counts and unsupported bound values are rejected without sending SQL. Server-side query errors retain their typed native error metadata. During an interrupted execution the connection and all its statements are invalidated; there is no automatic replay.

## Bounded native connection pools (experimental)

```js
import {createDatabasePool} from '@nublox/driver';

const pool=createDatabasePool({
  engine:'mysql',host:'127.0.0.1',port:3306,
  user:'myuser',password:process.env.MYSQL_PASSWORD,
  database:'mydb',security:'verified-tls',
  ca:process.env.MYSQL_CA_PEM,serverName:'localhost'
},{maxConnections:4,acquireTimeoutMs:5000,idleTimeoutMs:60000,healthCheckTimeoutMs:1500});

try {
  const rows=await pool.withConnection(async session=>{
    const result=await session.query('SELECT ? AS value',[42]);
    return result.rows;
  });
  console.log(rows);
} finally {
  await pool.close();
}
```

- `createDatabasePool` is **lazy**: it does not connect until requested, and holds at most 1–32 native connections. `acquireTimeoutMs` (100–120,000 ms) limits the time **waiting for a free slot**; native connection establishment retains its validated connection timeout.
- `withConnection` is an **exclusive callback lease**, not a raw connection checkout. A lease must not escape the callback; using it after completion throws `CONNECTION_CLOSED`. The callback **must await all started operations**. Unfinished operations or callback failure cause the native session to be discarded rather than reused.
- Before handing a healthy connection to another borrower, the MySQL adapter sends native `COM_RESET_CONNECTION` and requires an OK response. This resets active transactions, session/user variables, temporary tables, locks and server-prepared statements without repeating authentication. It is **not** equivalent to issuing only `ROLLBACK`. The default selected database remains the configured one. See [MySQL 8.4 reset semantics](https://dev.mysql.com/doc/c-api/8.4/en/mysql-reset-connection.html).
- If an operation is cancelled during execution, times out, or otherwise closes the connection, the pool **discards** it and establishes a new authenticated connection for a subsequent acquisition. Pool shutdown rejects pending checkouts, closes idle and active sessions and is idempotent.
- The shared pool schedules automatic **idle expiry**: idle sockets unused for `idleTimeoutMs` (100–3,600,000 ms; default 60,000 ms) are retired. The timer never interrupts a borrowed session; expiry only applies after a successful native reset.
- Before **every checkout**, MySQL's native `COM_PING` must succeed within `healthCheckTimeoutMs` (100–120,000 ms; default 1,500 ms). If the probe fails, the native session is discarded and another authenticated session may be established. The pool makes **at most one replacement attempt** for the current lease, and it never retries, duplicates or replays caller SQL.
- `pool.stats` is a frozen point-in-time snapshot: `size`, `idle`, `active`, `connecting`, `pending` and cumulative `created`, `discarded`, `expired`, `healthChecks`, `healthFailures` and `acquireTimeouts` counters. This is local, aggregate telemetry with no credentials, query text or row data. The pool has a bounded queue of 1,024 waiters.
- This is an **initial safe bounded pool**, not yet a production workload manager: no minimum warm pool, background keepalive, dynamic resize, priority scheduling, per-tenant quotas, cloud IAM re-authentication or cross-vendor qualification. The implementation is shared; **only MySQL 8.4 is currently tested**.

## Verify

```sh
npm install
npm test
NUBLOX_LIVE_MYSQL=1 MYSQL_PASSWORD=test-password npm test
npm pack --dry-run --workspace @nublox/driver
```

`npm test` also packs the compiled Driver into a `.tgz`, installs it offline in a separate temporary application, and exercises only the documented public package exports. When `NUBLOX_LIVE_MYSQL=1`, that independent consumer additionally executes a parameterised query against the real MySQL fixture and closes its connection. This guards against a package that passes source-tree tests but cannot be used by another application.

Live tests use pinned MySQL 8.4.11 GitHub Actions fixtures. The ordinary database is isolated on the runner's loopback interface. A second **TLS-required** MySQL instance uses ephemeral runner-generated CA/server certificates with a real hostname identity. Its tests verify a non-empty negotiated session TLS cipher, CA and hostname verification, prepared-query execution, authentication rejection, plaintext rejection and recovery from failed handshakes. All generated private keys are removed after CI. These tests establish **this specific target and deployment**, not unrestricted cloud, certificate lifecycle, or cross-vendor production support.

## Ownership

- `src/index.ts` is the only public export surface; the npm package exports compiled `dist/` files.
- `src/core/` owns public contracts, connection routing, errors, capability vocabulary and resource ceilings.
- `src/models/relational.ts` defines the relational session/transaction contract; other models are not created until implemented.
- `src/vendors/mysql/` owns authentication, the MySQL native protocol, metadata, types, capability evidence and adapter implementation.
- `tests/` contains unit and pinned-live-server conformance checks.

**Known architecture gaps:** pool warmup, background keepalive and quota policies; transport-independent cancellation, broader native type coverage and complete vendor-version capability negotiation are **not implemented**, rather than represented by empty placeholder modules. All existing MySQL TypeScript modules are now compiled under `strict` without `@ts-nocheck`. This does not establish production qualification: broader TLS deployment/certificate lifecycle, non-destructive server-side cancellation, production-grade pooling policies, comprehensive native type support, and operational conformance remain incomplete.
