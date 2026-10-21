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

Native bound parameters: null, boolean, UTF-8 string, binary Uint8Array, finite number (safe integer or double) and 64-bit bigint. Values are never interpolated into user SQL. Results preserve DECIMAL as string, LONGLONG as bigint, binary as Buffer and dates/times as formatted strings with no implicit timezone coercion. Results are limited to 10,000 rows or 8 MiB. Transactions use the callback-scoped `tx.query` method, not the parent session.

Supported experimental authentication plugins: `caching_sha2_password` (default MySQL 8.4) and `mysql_native_password` where the server enables it. Unencrypted RSA password exchange, connection pooling, reusable statements, compression, multiple results, cursor streaming, cloud IAM, cancellation **without closing the connection**, automated reconnect and non-SQL operations **are not supported**.

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

The CI suite verifies these states using real MySQL 8.4.11 instances, including TLS-connected cancellation and a fresh authenticated reconnection. Connection pooling, server-side kill/cancel, and independent per-query cancellation inside transactions are outside the current release scope.

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

**Known architecture gaps:** pooling, transport-independent cancellation, broader native type coverage and complete vendor-version capability negotiation are **not implemented**, rather than represented by empty placeholder modules. All existing MySQL TypeScript modules are now compiled under `strict` without `@ts-nocheck`. This does not establish production qualification: broader TLS deployment/certificate lifecycle, non-destructive server-side cancellation, pooling, comprehensive native type support, and operational conformance remain incomplete.
