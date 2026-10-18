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

Supported experimental authentication plugins: `caching_sha2_password` (default MySQL 8.4) and `mysql_native_password` where the server enables it. Unencrypted RSA password exchange, connection pooling, reusable statements, compression, multiple results, cursor streaming, cloud IAM, cancellation without closing the connection, automated reconnect and non-SQL operations **are not supported**.

## Verify

```sh
npm test
NUBLOX_LIVE_MYSQL=1 MYSQL_PASSWORD=test-password npm test
npm pack --dry-run --workspace @nublox/driver
```

Live tests require an isolated MySQL 8.4 server with `nublox_test` database and matching credentials. See the repository's pinned MySQL 8.4.11 GitHub Actions fixture. The initial MySQL integration fixture uses **isolated-local**; verified TLS still requires a separate real-server positive/negative qualification before any production claims.
