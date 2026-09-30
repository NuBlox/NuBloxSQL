# NuBloxSQL metadata and introspection

NuBloxSQL exposes one portable metadata catalog across MySQL, PostgreSQL, SQLite and SQL Server while preserving native/vendor detail on every returned object.

## Granular catalog access

Every `Client` exposes `metadata` and the equivalent `catalog` alias:

```js
const db = sql.createClient({ dialect: 'postgresql', ...config });

const schemas = await db.catalog.schemas();
const tables = await db.catalog.tables({ schema: 'public' });
const columns = await db.catalog.columns('customer', { schema: 'public' });
const indexes = await db.catalog.indexes('customer', { schema: 'public' });
const foreignKeys = await db.catalog.foreignKeys('customer', { schema: 'public' });
const constraints = await db.catalog.constraints('customer', { schema: 'public' });
```

The catalog supports:

- `databases()`;
- `schemas(options)`;
- `tables(options)`;
- `columns(table, options)`;
- `indexes(table, options)`;
- `foreignKeys(table, options)`;
- `constraints(table, options)`;
- `table(name, options)` for one fully populated table;
- `snapshot(options)` for a structured catalog snapshot.

## Structured snapshots

`client.introspect(options)` and `client.catalog.snapshot(options)` return the same immutable snapshot:

```js
const snapshot = await db.introspect({
  schema: 'public',
  tables: ['customer', 'order'],
  deep: true,
  concurrency: 4
});
```

The snapshot contains:

```text
{
  dialect,
  scope,
  databases,
  schemas,
  tables
}
```

With `deep: true` (the default), each table contains its columns, indexes, foreign keys and constraints. With `deep: false`, the result contains table summaries only.

`tables` may restrict deep inspection to a named subset. `concurrency` controls the maximum number of tables being expanded at once and defaults to 4.

## One-shot introspection

For tools, diagnostics, migration planners and schema browsers that do not need to retain a client, use the root helper:

```js
const snapshot = await sql.introspect(
  { dialect: 'mysql', ...config },
  { database: 'app', deep: true }
);
```

For explicit dialect routing:

```js
const snapshot = await sql.introspect(
  'postgresql',
  connectionConfig,
  { schema: 'public' }
);
```

The root helper owns the temporary client and closes it in a `finally` path whether introspection succeeds or fails.

## Portable shape and native evidence

Portable fields use the same vocabulary across dialects: database, schema, table name/type, column ordinal/type/nullability/default/identity/generated state, index uniqueness/columns, foreign-key references and referential actions, and constraint type/definition.

Dialect-specific rows and details remain available through each object's `native` property. NuBloxSQL does not discard vendor metadata merely to force a lowest-common-denominator model.

## Dialect semantics

- **MySQL** maps catalogs and schemas to MySQL database/schema namespaces and uses `information_schema`.
- **PostgreSQL** preserves separate database and schema concepts and uses `information_schema` plus `pg_catalog` where richer metadata is required.
- **SQLite** maps attached databases (`main`, `temp`, and attached names) into the catalog/schema vocabulary and uses PRAGMA plus `sqlite_schema`.
- **SQL Server** preserves database/schema separation and uses `sys.*` catalog views plus `INFORMATION_SCHEMA` where suitable.

The public shape is portable; the implementation remains dialect-aware.
