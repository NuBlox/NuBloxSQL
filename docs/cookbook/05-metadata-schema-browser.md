# Build a schema browser

**Scope:** portable unified-client metadata API with access to native-rich evidence.

NuBloxSQL can drive schema browsers, migration tooling, admin screens and code generators without forcing every dialect into the same native catalog shape.

## Deep introspection

```js
const { createClient } = require('nubloxsql');

async function loadSchema(config) {
  const db = createClient(config);

  try {
    return await db.introspect({
      deep: true,
      includeSystem: false,
      concurrency: 4
    });
  } finally {
    await db.close();
  }
}
```

The returned snapshot contains the native-rich collections plus `snapshot.portable`.

## Render a portable tree

```js
function printPortableSchema(snapshot) {
  console.log(`Dialect: ${snapshot.portable.dialect}`);
  console.log(`Vocabulary: v${snapshot.portable.vocabularyVersion}`);

  for (const table of snapshot.portable.tables) {
    console.log(`${table.kind}: ${table.schema || '-'} . ${table.name}`);

    for (const column of table.columns) {
      console.log(
        `  ${column.name} ${column.nativeType || column.dataType || '?'} ` +
        `[${column.nullability}]` +
        (column.primaryKey ? ' PK' : '') +
        (column.identity ? ' IDENTITY' : '')
      );
    }

    for (const index of table.indexes) {
      console.log(`  INDEX ${index.name} unique=${index.unique}`);
    }

    for (const fk of table.foreignKeys) {
      console.log(
        `  FK ${fk.name || '<unnamed>'}: ` +
        `${fk.columns.join(',')} -> ${fk.referencedTable}(${fk.referencedColumns.join(',')})`
      );
    }
  }
}
```

Use the portable projection for cross-dialect UI structure. Use `native` payloads when a feature needs engine-specific catalog facts.

## Query individual catalog areas

The client exposes `db.metadata`/`db.catalog` access to specific metadata areas.

```js
const tables = await db.metadata.tables({ schema: 'public' });
const columns = await db.metadata.columns('users', { schema: 'public' });
const indexes = await db.metadata.indexes('users', { schema: 'public' });
const foreignKeys = await db.metadata.foreignKeys('users', { schema: 'public' });
const constraints = await db.metadata.constraints('users', { schema: 'public' });
```

For MySQL, the schema/database distinction follows MySQL semantics. SQLite synthesizes the portable scope from attached databases. PostgreSQL retains real catalog/schema information.

## Compare two environments

A simple drift detector can compare stable portable fields while deliberately ignoring native fields that contain engine-specific noise.

```js
function tableKey(table) {
  return [table.database || '', table.schema || '', table.name].join('/');
}

function indexTables(snapshot) {
  return new Map(snapshot.portable.tables.map((table) => [tableKey(table), table]));
}

function compareTableNames(left, right) {
  const a = indexTables(left);
  const b = indexTables(right);

  return {
    missingFromRight: [...a.keys()].filter((key) => !b.has(key)),
    missingFromLeft: [...b.keys()].filter((key) => !a.has(key))
  };
}
```

A production schema-diff tool should compare columns, constraints, indexes and type semantics explicitly rather than serializing whole snapshots and doing a byte-level diff.

## Security

Catalog access can reveal object names and schema structure. Apply the same authorization controls to schema-browser endpoints that you would apply to other administrative tooling.

See [metadata and introspection](../guides/07-metadata-and-introspection.md) and [TypeScript](../guides/12-typescript.md).
