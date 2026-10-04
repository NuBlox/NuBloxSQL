# Canonical schema snapshots

NuBloxSQL canonical schema snapshots combine portable metadata, deterministic object identity, dependency relationships and canonical type semantics into one immutable schema model.

## Build from a live database

```js
const snapshot = await db.schemaSnapshot({
  schema: 'public',
  deep: true
});
```

You can also build from an existing portable metadata snapshot:

```js
const metadata = await db.introspect({ deep: true });
const snapshot = sql.buildSchemaSnapshot(metadata);
```

## Two identity layers

Every object retains its NuBloxSQL database identity (`id`) and also receives a dialect-neutral `logicalKey`.

The database identity is appropriate for addressing an object inside a specific engine. The logical key is appropriate for correlating the same logical object across snapshots and dialects.

## Two fingerprints

`semanticHash` is calculated from canonical schema meaning. It excludes dialect-native type spelling and engine identity.

`sourceHash` includes the source dialect and source-native type spelling in addition to the canonical semantic model.

```js
const semantic = sql.schemaFingerprint(snapshot);
const sameMeaning = sql.schemasEquivalent(left, right);
const sameSourceRepresentation = sql.sourceSchemasEquivalent(left, right);
```

This distinction allows PostgreSQL `INTEGER` and MySQL `INT`, for example, to compare as semantically equivalent while still retaining different source representations.

## Snapshot contents

A snapshot currently contains:

- databases;
- schemas;
- tables, views and foreign tables;
- columns and canonical types;
- nullability/default/identity/generated-column semantics;
- indexes and key parts;
- foreign keys;
- constraints;
- dependency edges expressed using dialect-neutral logical keys.

All arrays are deterministically ordered before hashing.

## Determinism

Catalog row order does not affect the resulting fingerprints. Columns are normalized by ordinal and other object collections by logical identity.

Native metadata blobs are deliberately excluded from semantic hashing. This prevents engine-internal catalog detail from making two semantically equivalent schemas appear different.

## Current boundary

The schema snapshot is a normalized representation, not yet a migration plan. It does not yet:

- infer renames;
- calculate added/removed/changed objects;
- classify destructive changes;
- generate migration DDL;
- resolve all vendor-specific object families.

Those capabilities belong to the schema-diff and migration-planning layers built on top of this model.
