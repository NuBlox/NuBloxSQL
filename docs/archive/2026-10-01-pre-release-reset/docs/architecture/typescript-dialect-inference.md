# TypeScript dialect discrimination and inference

NuBloxSQL's TypeScript surface treats the selected SQL dialect as a discriminator rather than collapsing every API call into broad unions.

## Canonical dialect mapping

Aliases are normalized at the type level in the same way as the runtime:

- `postgres` / `pg` -> `postgresql`
- `mssql` / `sql-server` -> `sqlserver`

`CanonicalDialect<D>` exposes this mapping for tooling and library authors.

## Dialect-mapped public types

The package exports:

- `DialectAdapter<D>`
- `DialectConnection<D>`
- `DialectPool<D>`
- `DialectConnectionConfig<D>`
- `DialectClientConfig<D>`
- `DialectNative<D>`
- `DialectClient<D>`

Convenience aliases are also exported as `MySqlClient`, `PostgreSqlClient`, `SqliteClient` and `SqlServerClient`.

A dialect-discriminated client preserves the selected dialect through `dialect`, `config`, `adapter`, `native` and transaction callbacks.

```ts
const db = sql.createClient({
  dialect: 'postgresql',
  host: 'db.internal',
  user: 'app'
});

// PostgreSqlClient
// db.dialect is "postgresql"
// db.native is PostgreSQL Connection | Pool
await db.transaction(async (tx) => {
  // tx is also PostgreSqlClient
});
```

## URL inference

Literal connection URLs also narrow the result:

```ts
const mysqlDb = sql.createClient('mysql://user:pass@host/app');
// MySqlClient

const sqliteDb = sql.createClient('sqlite::memory:');
// SqliteClient
```

A generic `URL` value cannot safely communicate its scheme at compile time, so its return type remains the union of supported client types.

## Native connection and pool inference

`createConnection()` and `createPool()` retain native engine types when the dialect or URL is known. SQLite intentionally maps `DialectPool<'sqlite'>` to `never` because NuBloxSQL does not claim SQLite pooling support.

SQL Server pooling is represented as supported, matching the runtime capability instead of the previous overly restrictive declaration.

## Capability, transaction and metadata reports

`capabilityReport(dialect)`, `transactionPolicy(dialect)` and dialect-qualified `introspect(...)` preserve the canonical dialect as a literal type in their returned report/snapshot.

## Compatibility rule

The runtime API is unchanged by this slice. The work only makes the published TypeScript declarations more precise. Broad fallbacks remain for values whose dialect cannot be known statically.
