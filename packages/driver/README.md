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

Native bound parameters: null, boolean, UTF-8 string, binary Uint8Array, finite number (safe integer or double) and 64-bit bigint. Values are never interpolated into user SQL. Results are limited to 10,000 rows or 32 MiB of serialized row packets; a single logical MySQL message is capped at 32 MiB. Transactions use the callback-scoped `tx.query` method, not the parent session. Parent-session commands attempted within transaction or cursor callbacks now fail promptly with typed `INVALID_INPUT` rather than deadlocking.

### Native Classic protocol fragmentation (experimental)

- MySQL's 4-byte physical-frame header has a 24-bit payload length, capped at **16,777,215 bytes**. Native commands and result rows can span multiple frames; the Driver sends/reassembles these fragments while validating a monotonically incrementing (wrapping) sequence number.
- A logical message whose length is an **exact multiple of 16,777,215 bytes** includes the required final **empty frame**. The fragmentation codec never merges independent result rows.
- Incoming framing uses incremental, bounded subarray accumulation rather than repeatedly concatenating the entire growing receive buffer. Both inbound and outbound logical messages are limited to **32 MiB** for predictable resource use. Over-limit incoming messages cause a fail-closed connection; outbound oversized commands are rejected before writing.
- This is bounded large-packet transport support; the separate native read-only cursor API below provides bounded row-fetching. `query()` still materialises results in memory and caps rows/aggregate row bytes. Large enterprise exports need a separately qualified streaming/cursor API. Server-side `max_allowed_packet` may impose a lower limit.

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

Supported experimental authentication plugins: `caching_sha2_password` (default MySQL 8.4) and `mysql_native_password` where the server enables it. Unencrypted RSA password exchange, compression, semicolon-delimited multi-statements, cloud IAM, cancellation **without closing the connection**, automated reconnect and non-SQL operations **are not supported**.

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
- **Transactions:** the transaction-level signal and deadline cover the callback. Cancellation during a transaction disconnects rather than claiming a confirmed rollback; the caller must verify the outcome before retrying potentially non-idempotent writes. Normal application callback failures still roll back and leave a healthy connection usable. All `tx.query()` calls are serialised in submission order on the native socket, including callers using `Promise.all`. Parent-session `query`, `prepare`, `transaction`, `withCursor`, or another prepared-statement operation from the **same active callback** rejects with `INVALID_INPUT` instead of waiting on its own lock. Other callers outside the callback still queue normally. Transaction handles cannot be invoked from a different asynchronous context.
- **Scope:** AbortSignal stops database I/O; it cannot forcibly terminate unrelated user JavaScript already running inside a transaction callback.

The CI suite verifies these states using real MySQL 8.4.11 instances, including TLS-connected cancellation and a fresh authenticated reconnection. Advanced pooling policies, server-side kill/cancel, and independent per-query cancellation inside transactions are outside the current release scope.

## Deterministic native protocol fault injection

MySQL Classic frame corruption and network termination are distinct outcomes:

- An unexpected physical-frame sequence or malformed Classic packet framing
  reports `PROTOCOL_ERROR` and closes the physical connection. Incoming
  logical-message or queued-message safety limits continue to report
  `RESOURCE_LIMIT`. Both are terminal for the affected socket: queued work
  is rejected, prepared handles are invalidated and the pool discards it.
- A transport that ends halfway through a header, payload, prepared response,
  or large bound-parameter upload reports `CONNECTION_CLOSED`. There is no
  assumption that a non-idempotent command failed to execute, and **no
  automatic SQL replay**. The existing uncertain-commit rules below still
  take precedence for a lost `COMMIT` acknowledgement.
- `RESOURCE_LIMIT`, `CANCELLED` and `TIMEOUT` retain their specific codes;
  the connection can still be discarded independently of error reporting.

`packages/driver/tests/fixtures/mysql-fault-proxy.mjs` is a **test-only**
loopback TCP proxy that damages a selected authenticated MySQL reply or cuts
a large outbound command. It is not a production proxy or public API.
The pinned MySQL 8.4.11 tests verify corrupted frame sequences, partial
headers and bodies, interrupted 17 MB uploads and 24 pooled borrowers
recovering after a single injected failure. Raw SQL and credentials are not
logged by the fault proxy. Verified TLS remains qualified independently via
real authenticated transport interruption and transaction-outcome tests.

## Deterministic fault-matrix qualification

The native transport tests now exercise incomplete frame headers, truncated
payloads, missing exact-frame terminators, and aggregate receive queue
pressure. A queue of individually valid messages is capped at **32 MiB in
total** while unread, not merely 32 MiB per message. Excess queued bytes
raise `RESOURCE_LIMIT`, invalidate the stream and release buffered fragments.

Live MySQL 8.4 exercises a paused large-result read that loses its physical
socket and then verifies a separate connection succeeds, plus 36 concurrent
pool callbacks with deliberate application failures. The tests prove bounded
recovery and no callback replay in those conditions; they do not yet prove
server-process crash recovery, adversarial network partitions or overnight
fault-soak reliability.

## Transport fault handling and uncertain commit outcomes (experimental)

Native transport failures are terminal for a physical MySQL session. A TCP
`error`, half-close (`end`) or full `close`, including while **idle**,
immediately closes the session, invalidates its native prepared statement
handles and rejects queued commands. Pool borrowing never reuses a stale
physical connection. An active read interrupted by a lost transport rejects
with `CONNECTION_CLOSED`, not an arbitrary unhandled low-level socket error.

An interrupted transaction has two materially different outcomes:

- A regular application error while a valid transaction is active triggers
  an explicit `ROLLBACK` and leaves the session usable if the server
  acknowledges it. Loss of the connection **before a COMMIT request** cannot
  establish that any prior **non-transactional** statement was undone.
- After the driver begins sending `COMMIT`, a lost or invalid acknowledgement
  produces `TRANSACTION_OUTCOME_UNKNOWN`, destroys the socket and forbids
  automatic replay. The database might have made the transaction durable,
  rolled it back, or be recovering. The application must reconcile using
  business identifiers/idempotency keys and authoritative database state
  before making any retry decision. This error is intentionally conservative
  even if the connection was explicitly closed while the commit was pending.

The active-operation cancellation and deadline machinery still uses
`CANCELLED` and `TIMEOUT` before the COMMIT phase. Once COMMIT starts,
the specific outcome-unknown code takes precedence, including when the socket
is closed or a deadline fires before acknowledgement. No transparent retry
of SQL, committed writes, procedures, or transaction callbacks is performed.

Live MySQL 8.4.11 fault tests destroy authenticated TCP sockets while idle
and during reads, drop the transport immediately after a real `COMMIT` frame,
and verify pool replacement and prepared-handle invalidation. Verified TLS
tests exercise the same state transitions. Fault injection is confined to
tests; raw sockets are not part of the public API. This is not a substitute
for full process-crash, failover, partition, or durability certification.

## Native prepared stored-procedure result sets (experimental)

MySQL 8.4 stored procedures may return multiple result sets plus a final status,
and prepared `CALL` can additionally return an OUT-parameter set. NuBloxSQL
negotiates `CLIENT_MULTI_RESULTS` and `CLIENT_PS_MULTI_RESULTS` but **never
enables CLIENT_MULTI_STATEMENTS**. This means semicolon-separated SQL
statements are not implicitly enabled.

```js
const sets=await db.queryResults('CALL nublox_multi_result(?)',[41]);
for(const result of sets){
  console.log(result.rows,result.columns,result.status,result.outParameters);
}

const statement=await db.prepare('CALL nublox_multi_result(?)');
try{
  const again=await statement.executeResults([42]);
}finally{await statement.close();}
```

- `queryResults(sql, params?, options?)` returns an ordered `QueryResult[]`,
  including the **final status-only OK result** from a stored procedure.
  A normal SELECT or DML produces an array with one result.
- `prepared.executeResults(params?, options?)` preserves reusable server-side
  prepared-statement ownership. `tx.queryResults(...)` serializes in order
  with `tx.query(...)`; pooled leases provide `queryResults(...)` and
  prepared `executeResults(...)` while active.
- Each result preserves its original ordered `columns`, collision-free
  `columnKeys`, `rows`, `rowValues`, `status` and `warnings`.
  `outParameters===true` identifies a set MySQL marks with
  `SERVER_PS_OUT_PARAMS`.
- The existing `query()` and `prepared.execute()` intentionally remain
  **single-result** APIs. When used for a multi-result CALL, they **drain every
  result before rejecting with `UNSUPPORTED_FEATURE`**, preserving protocol
  synchronisation. Use the explicit plural methods for procedures.
- **Hard limits** apply across the complete execution: at most **32 result
  sets** (including status), **10,000 combined rows**, and **32 MiB combined
  row packet bytes**. An over-limit or malformed stream destroys the
  connection rather than returning incomplete results or reusing an
  unsynchronised socket. These APIs materialize bounded results in memory;
  server-cursor streaming remains a separate read-only API.
- Stored-procedure tests use the fixed SQL fixtures in
  `tests/fixtures/multi-results.sql`. The MySQL 8.4.11 CI jobs install them
  for normal and verified-TLS protocol qualification.

## Bounded native read-only cursors (experimental)

`withCursor(sql, params, callback, options?)` uses the MySQL Classic
`COM_STMT_EXECUTE` read-only cursor flag followed by `COM_STMT_FETCH`, not
client-side pagination or `LIMIT/OFFSET`. Each fetch holds at most 1–256
decoded rows in memory (default: 64), and the overall cursor is forward-only.

```js
await db.withCursor(
  'SELECT id, name FROM customers ORDER BY id',[],
  async cursor=>{
    for await(const {row,values} of cursor){
      console.log(row.id,row.name); // values preserves duplicate-name ordinals
      if(row.id===100n)break;       // early exit closes the server statement
    }
  },
  {fetchSize:64,timeoutMs:30000}
);
```

- Callback lifetime is **exclusive**: no other command on the same native connection runs until the callback exits and the statement closes. Always `await` cursor fetches; parent-session `query`, `prepare`, `transaction`, `withCursor` or prepared-statement execute/close attempted from the active callback reject with `INVALID_INPUT` rather than waiting on their own lock. `session.close()` is an immediate destructive shutdown and should not be used as nested cursor control.
- The cursor exposes `columns`, collision-free `columnKeys`, `closed`, and `AsyncIterableIterator<{row,values}>`. The iterator's `values` remains aligned with `columns`, even for duplicate aliases.
- Each `COM_STMT_FETCH` response is bounded to the requested fetch size and a 32 MiB message budget. The callback returns before the next fetch; there is no unbounded application-side queue. A single individual row may still use up to the configured message limit.
- At the end of iteration, early `break`, callback error or completion, NuBloxSQL sends `COM_STMT_CLOSE` to release the server cursor. Unawaited fetches cause the connection to be discarded to prevent reuse of an uncertain protocol state.
- `AbortSignal` and `timeoutMs` apply to the **entire cursor callback**, not per fetch, using the existing session cancellation contract. An active cancellation or timeout discards the connection; there is no automatic retry or claim of completed transaction rollback.
- Pool callers use `pool.withConnection(async session => session.withCursor(...))`: the callback-scoped lease remains owned until the cursor is closed and the session is reset for reuse.
- Only simple forward-only read-only MySQL prepared cursor result sets are qualified. MySQL may decline to open a cursor for some SQL; NuBloxSQL reports `UNSUPPORTED_FEATURE` and does not silently materialise that result as a fallback. More comprehensive performance benchmarks, multi-results, resumability and transaction-integrated cursor orchestration remain future work.

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
- Each connection permits at most **128 simultaneously open reusable statements**. Explicitly close them to reclaim server resources; there is no implicit LRU cache, cross-connection cache or cross-connection prepared statement reuse.
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
- `withConnection` is an **exclusive callback lease**, not a raw connection checkout. A lease must not escape the callback; using it after completion throws `CONNECTION_CLOSED`. The callback **must await all started operations**. Unfinished operations or callback failure cause the native session to be discarded rather than reused. Calling `pool.withConnection()` on the **same pool** from within an active pool lease rejects immediately with `INVALID_INPUT` rather than deadlocking when capacity is one; callers outside the lease continue to queue. Different pool instances are independent.
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

### Unawaited cursor work at callback completion or failure

A native cursor exclusively owns one MySQL session while its callback runs.
A caller must await each `cursor.next()` before the callback returns or
throws. If any fetch remains in flight when the callback exits, NuBloxSQL
destroys the physical session and revokes the cursor **before** attempting
`COM_STMT_CLOSE`. This also covers exception paths, which must not let
native close race an unfinished `COM_STMT_FETCH` request.

The session is not reusable after that race; a pooled lease discards its
connection and the next borrower receives a newly authenticated socket.
The driver never sends a delayed fetch on a terminated connection or
replays SQL. Fully awaited cursors, including intentionally early exits,
continue to use the normal close and pool-reset lifecycle.

### Fail-closed server-side cursor fetches

A native server cursor holds an exclusive session lock across its callback.
For `COM_STMT_FETCH`, an `ERR` packet after at least one binary row has
already been received leaves the fetch response incomplete. NuBloxSQL
preserves the structured `DATABASE_ERROR` but destroys the native
connection, revokes the cursor and skips `COM_STMT_CLOSE` into an
untrusted response. A server error interrupting cursor result metadata
after the row-set header is handled in the same fail-closed way.

A first-packet fetch error is distinguished from a partial batch; valid
early cursor termination still closes the native statement and preserves
healthy session reuse. A pool discards any poisoned socket and acquires a
new authenticated connection for subsequent independent work. No cursor
fetch or application statement is replayed.

### Prepared-result server errors and safe session reuse

A MySQL server `ERR` packet received as the **first** response to a
prepared statement is a normal SQL failure. NuBloxSQL preserves its
structured `DATABASE_ERROR` and allows the authenticated session and
statement to remain usable, for example after a primary-key violation.

If an `ERR` arrives **after** the server has already started streaming
result-set metadata, rows or multiple result sets, NuBloxSQL preserves the
structured database error but **destroys the physical session**. The
remainder of that response cannot be trusted as a complete protocol boundary.
No `COM_STMT_CLOSE` is transmitted into an incomplete response and no
application SQL is replayed. A pool discards the affected connection and
later work obtains a newly authenticated session.

### Queued prepared work and session reset ownership

A prepared handle belongs to the native statement generation in which MySQL
created it. `COM_RESET_CONNECTION` releases server-side prepared statements
without closing the physical socket. Calls to `execute()` or
`executeResults()` that entered the bounded FIFO **before** a reset completed
must revalidate statement ownership **when their command begins**. If the
handle has been revoked, the operation rejects with `CONNECTION_CLOSED`
without sending the stale statement ID or destroying the healthy reset
connection.

The same guard skips `COM_STMT_CLOSE` for a handle already released by
an earlier reset; it cannot accidentally target a new statement generation.
Executions that were accepted ahead of an ordinary explicit `close()`
remain FIFO ordered and may finish before their own close command; new
executions after `close()` are rejected. Connection loss permanently
revokes all handles, including those with pending operations.

### Retryable native prepared-statement closure under queue pressure

The session's bounded command FIFO can reject a new `COM_STMT_CLOSE` with
`RESOURCE_LIMIT` before a byte is sent. In this case NuBloxSQL keeps the
server-side statement **allocated, counted and usable**, resets its local
closing state and allows the caller to retry `close()` after the backlog
drains. Concurrent close callers share the original attempt; no duplicate
native close is transmitted. A simultaneous connection reset or transport
failure instead revokes the handle permanently and can never be undone by
a late queue-overload error.

Applications should retry explicit statement cleanup after `RESOURCE_LIMIT`
once session queue pressure subsides. Closing a prepared handle never
automatically replays application SQL.

### Fail-closed prepared-statement metadata

After a valid `COM_STMT_PREPARE_OK`, the server has assigned a native
statement ID but can still be delivering parameter and result-column
metadata. A failure while consuming this metadata — including a typed
server `DATABASE_ERROR` — makes the native packet-exchange boundary
untrustworthy. NuBloxSQL destroys the physical connection, invalidates
outstanding statement handles and refuses to return that session to a pool.

The Driver does not send `COM_STMT_CLOSE` into a partially consumed metadata
exchange and does not replay preparation or subsequent application SQL.
A new authenticated session may be acquired for later independent work.

### Strict native prepared-statement creation

The native `COM_STMT_PREPARE_OK` response must contain exactly twelve payload
bytes under NuBloxSQL's negotiated MySQL Classic capabilities: status,
statement ID, column count, parameter count, a zero-valued reserved byte and
warning count. Extra or missing bytes and a nonzero reserved byte are
`PROTOCOL_ERROR` failures. Since the server may already have allocated a
statement and its metadata exchange is no longer trustworthy, the driver
invalidates that entire native connection rather than reusing its packet
stream or returning an unverified prepared handle. The pool discards that
connection; application SQL is not replayed automatically.

### Strict prepared-statement result acknowledgements

Prepared SQL without a row set (for example `INSERT`, `UPDATE`, and
`DELETE`) can return a Classic Protocol 4.1 OK packet. NuBloxSQL applies
the **same complete-packet validation** used for transaction and pool control:
both length-encoded counters, status and warnings must be present. Valid
multi-result continuation flags and optional informational text remain
supported. A syntactically correct physical frame with an incomplete OK body
is not evidence that an SQL statement succeeded.

On malformed prepared SQL OK replies, the Driver reports `PROTOCOL_ERROR`,
invalidates the physical session and prepared handles, and discards that
connection from a pool. The server may already have applied the statement:
NuBloxSQL **does not automatically replay** an operation with an unknown
effect. Callers must reconcile any business effects before deciding whether
to retry.

### Verified MySQL command acknowledgements

NuBloxSQL requires complete Classic Protocol 4.1 OK payloads before accepting
`START TRANSACTION`, `COMMIT`, `ROLLBACK`, `COM_PING` or
`COM_RESET_CONNECTION` as confirmed. The required length-encoded affected-row
and insert-ID fields, two-byte server status and two-byte warning count must
be present; optional informational bytes remain supported. A packet that
merely starts with `0x00` is insufficient even if the physical frame length
and packet sequence are valid.

Malformed transaction acknowledgements are handled through the existing
outcome-unknown safeguards for COMMIT and ROLLBACK. Malformed pool health or
reset acknowledgements trigger `PROTOCOL_ERROR` and discard the session.
Neither SQL nor transaction-control commands are automatically replayed.

### Rollback acknowledgement and uncertain outcomes

Transaction cleanup is not considered confirmed merely because the Driver
sent `ROLLBACK`. If the acknowledgement is lost, rejected or malformed, the
Driver returns `TRANSACTION_OUTCOME_UNKNOWN`, permanently closes that physical
session, and **does not issue a second rollback or retry application SQL**.
This is deliberately conservative: it cannot certify whether the server
applied rollback when the response was unavailable. On an acknowledged
rollback, the original application callback error is returned unchanged and
the session remains reusable. A caller seeing an unknown outcome must
reconcile application state using a newly authenticated connection.

### Fail-closed outbound writes

A Classic packet may have been partially transmitted when Node reports an
outbound socket write failure. This state cannot be repaired safely by
rewinding a packet sequence or automatically retrying SQL. Both callback
failures (even without a socket `error` event) and synchronous write
exceptions now invalidate the packet stream, reject pending reads and queued
session work, and destroy the transport. Any affected transaction commit
remains subject to the existing **outcome unknown** safeguards. A new
authenticated connection is required; the original operation is never
replayed. Driver-generated failures do not expose raw callback messages.

### Outbound small-packet transport

The Classic protocol encoder writes framed commands up to 4,096 payload
bytes using a single socket write (header and payload together), reducing
per-command Node.js socket write/callback overhead. The threshold is a
**bounded-copy optimisation**, not a public configuration or performance
guarantee. Larger frames continue to write their 4-byte header and a
zero-copy payload view separately; the 24-bit frame length, rollover
sequence, empty trailers, logical 32 MiB cap and socket backpressure
behaviour are unchanged. CI checks both exact wire bytes and live MySQL
operations; benchmark results are workload-specific and should not be
described as product-wide speedups.
