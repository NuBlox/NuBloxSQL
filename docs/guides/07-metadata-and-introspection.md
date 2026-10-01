# Metadata and introspection

NuBloxSQL exposes both native-rich metadata and a portable projection.

## Catalog API

Every unified client exposes `db.metadata`/`db.catalog` metadata access.

```js
const databases = await db.metadata.databases();
const schemas = await db.metadata.schemas();
const tables = await db.metadata.tables();
const columns = await db.metadata.columns('users');
const indexes = await db.metadata.indexes('users');
const foreignKeys = await db.metadata.foreignKeys('users');
const constraints = await db.metadata.constraints('users');
const table = await db.metadata.table('users');
```

`table(name)` returns `null` if the table is not found.

## Scope

Metadata operations accept scope where relevant:

```js
const tables = await db.metadata.tables({
  database: 'app',
  schema: 'public',
  includeSystem: false
});
```

Some engines do not have database/schema concepts matching PostgreSQL-style catalog semantics. NuBloxSQL exposes honest values rather than inventing equivalence.

## Deep snapshot

Use `introspect()` for a coherent snapshot:

```js
const snapshot = await db.introspect({
  deep: true,
  concurrency: 4
});
```

The snapshot contains:

```text
dialect
scope
databases[]
schemas[]
tables[]
portable
```

With deep introspection, table entries can include columns, indexes, foreign keys and constraints.

A one-shot top-level helper is also available:

```js
const { introspect } = require('nubloxsql');
const snapshot = await introspect(config, { deep: true });
```

## Portable metadata vocabulary v1

`snapshot.portable` is immutable and carries `vocabularyVersion: 1`. It provides a common vocabulary for PostgreSQL, MySQL and SQLite while preserving native payloads.

```js
const snapshot = await db.introspect({ deep: true });

for (const table of snapshot.portable.tables) {
  console.log(table.kind, table.schema, table.name);
  for (const column of table.columns) {
    console.log(column.name, column.nullability, column.identity);
  }
}
```

Portable table kinds are `table`, `view` and `foreign-table`.

Portable column information includes database/schema/table/name, ordinal, `dataType`, `nativeType`, nullability, default evidence, primary-key membership, identity/auto-increment state, generated-column information and the original native payload.

Portable indexes include uniqueness, primary status, method, predicate and ordered key parts. Portable foreign keys retain source/reference scopes, ordered columns, update/delete actions and deferrability evidence where available. Common constraint kinds are normalised to names such as `primary-key`, `foreign-key`, `unique`, `check` and `not-null`.

## Native metadata remains authoritative

The portable projection is not a replacement for engine-specific facts. When your application depends on PostgreSQL catalog OIDs, MySQL engine/security metadata, SQLite DDL text or another native detail, use the native-rich metadata fields.

Each portable object retains a `native` property so normalization does not discard engine evidence.

## Filtering tables

Deep introspection supports an optional table-name selection:

```js
const snapshot = await db.introspect({
  deep: true,
  tables: ['users', 'roles']
});
```

Use focused introspection for large catalogs when you only need a subset.

## Metadata and migrations

Metadata is an inspection API, not a migration engine. Do not infer that a portable metadata shape guarantees portable DDL generation. Use the capability model and vendor-specific rules when translating schema semantics.