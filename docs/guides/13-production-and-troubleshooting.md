# Production operation and troubleshooting

## Production checklist

Before deployment, confirm the application runs a supported Node.js version and that the database version is inside the qualified scope documented in `docs/SUPPORT.md`. Versions outside the matrix may work but are not part of the current qualification claim.

Use environment/secrets management for credentials. Enable TLS/certificate verification for network databases. Configure pools deliberately. Set operation/acquisition timeouts. Bound large results. Close resources deterministically. Exercise failure paths in integration tests.

## Pool sizing

A larger pool is not automatically faster. Size pools against database connection limits, application concurrency and query duration. Remember that every application replica can create its own pool.

Monitor total, idle, borrowed and waiting connection counts through telemetry/native pool state where available. Sustained waiting indicates either insufficient connection capacity or work that holds connections too long.

## Timeouts

Set different limits for different failure domains:

- connection establishment timeout;
- pool acquisition timeout;
- operation/query timeout;
- cancellation timeout where supported.

Do not set every timeout to the same arbitrary value. A database operation may legitimately run longer than a connection acquisition should wait.

## Result limits

Use `maxRows`, `maxResultBytes` and `maxRowBytes` for endpoints that could otherwise materialise uncontrolled results. Use streaming when processing large data sets incrementally.

Large-result controls protect the Node.js process; they do not replace SQL predicates, indexes or database workload governance.

## SQLite production settings

For SQLite, consider `productionDefaults`, WAL mode, synchronous policy and a nonzero `busyTimeout` based on your durability/concurrency requirements:

```js
const db = createClient({
  dialect: 'sqlite',
  filename: './data/app.db',
  productionDefaults: true,
  journalMode: 'wal',
  synchronous: 'normal',
  busyTimeout: 5_000,
  foreignKeys: true
});
```

Do not copy these values blindly for every workload. WAL changes concurrency/recovery behaviour, and synchronous policy changes durability/performance trade-offs.

SQLite also exposes native integrity, foreign-key, checkpoint, optimize/vacuum and resource-governance APIs. Schedule maintenance according to workload and storage requirements rather than on every request.

## TLS failures

If TLS verification fails, fix the trust chain, server name or certificate configuration. Disabling certificate verification should be a controlled diagnostic step, not the permanent production fix.

## Authentication failures

Authentication errors are normally configuration/policy failures, not transient retries. Verify username, secret, authentication plugin/method, transport requirements and server policy.

MySQL cleartext authentication is explicitly guarded. PostgreSQL SSL/SCRAM behaviour and SQL Server TLS/TDS settings are controlled by their native configurations.

## Timeout versus cancellation

A timeout/cancellation error means the client stopped waiting or attempted cancellation; application code should not infer business outcome for a write without transaction/database evidence. For critical writes, use transactions and idempotency/business keys so uncertain outcomes can be safely reconciled.

## Deadlocks and serialization failures

Use transaction retry policy, not an unconditional loop around arbitrary statements. Ensure transaction callbacks can safely execute more than once and keep transactions short.

## Cardinality failure from `one()`

If `one()` throws `cardinality`, determine whether zero rows or multiple rows are valid. If yes, use `all()` and handle the collection. If not, keep `one()` and fix the data/query invariant.

## Resource leaks

Symptoms include pool acquisition timeouts, increasing waiting counts, open cursors/streams, or shutdown hangs. Verify every created client/pool, prepared statement, stream, cursor and subscription has an ownership/close path.

## Metadata appears incomplete

Call `introspect({ deep: true })` when columns/indexes/foreign keys/constraints are required. Check scope (`database`, `schema`, `includeSystem`) and dialect permissions. Use `snapshot.portable` for common fields and native metadata when vendor-specific evidence is required.

## Portability failure

If SQL runs on one engine but not another, first check the Tier-1 capability model rather than adding string replacements. Determine whether the feature is native/equivalent/emulated/partial/runtime-dependent/unsupported. Use rewrite/transpile APIs only inside their documented current scope.

## Diagnostic information to capture

For a production incident capture: NuBloxSQL version, Node.js version, dialect and database server version, portable error category/code, SQLSTATE/native code, operation type, retryable flag, pool state, timeout settings and a redacted reproduction. Do not include credentials or sensitive bound values.

## Release verification

From a repository checkout:

```bash
npm install
npm run verify
npm run test:sqlite-production
npm run test:tier1-evidence
npm run release:check
```

The package deliberately declares no third-party npm dependencies. A release check also verifies the proprietary boundary, public package surface, qualification evidence and documentation contract.