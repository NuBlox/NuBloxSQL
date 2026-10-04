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

## Canonical structure tree

Use `structureTree()` when you need a hierarchical representation rather than flat metadata arrays:

```js
const tree = await db.structureTree({
  schema: 'public',
  deep: true
});
```

The released hierarchy is database → schema → table/view/foreign-table → columns/indexes/foreign keys/constraints. Every node retains its portable metadata object, a stable hierarchical `path`, and immutable `children`.

You can also build a tree from an existing snapshot without another database connection:

```js
const snapshot = await db.introspect({ deep: true });
const tree = buildStructureTree(snapshot);
```

Child families can be omitted when a lighter tree is useful:

```js
const tree = await db.catalog.structureTree({
  tree: { indexes: false, constraints: false }
});
```

This is a data-model API rather than a UI contract. It is intended to support database exploration, structure export, diagrams, comparison and migration tooling without coupling those concerns to a particular interface.


## Stable object identity

Structure-tree nodes carry deterministic NuBloxSQL object IDs. IDs are derived from dialect, object kind and catalog scope rather than metadata row order.

```js
const ordersId = objectId(
  'table',
  { database: 'app', schema: 'public', name: 'orders' },
  { dialect: 'postgresql' }
);

const parts = parseObjectId(ordersId);
```

Unnamed foreign keys and constraints receive deterministic structural identities derived from their defining metadata, so they can still participate in graph and snapshot correlation.

## Dependency graph and impact analysis

Use `dependencyGraph()` to derive object relationships from a deep metadata snapshot:

```js
const graph = await db.dependencyGraph({
  schema: 'public',
  deep: true
});
```

Edges point from an object to the object it depends on. For example, a foreign-key table has a `references` edge to the referenced table, an index has `uses-column` edges, and columns participating in foreign keys have `references-column` edges.

```js
const dependencies = graphDependencies(graph, objectIdValue);
const dependents = graphDependents(graph, objectIdValue);
const impact = impactAnalysis(graph, objectIdValue);
```

Traversal is transitive by default and can be restricted by relation or to direct neighbors. This provides the first released foundation for change-impact analysis, dependency diagrams, schema comparison ordering and safe migration planning.
