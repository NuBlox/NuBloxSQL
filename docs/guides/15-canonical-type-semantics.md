# Canonical type semantics

NuBloxSQL exposes a product-level type model that connects metadata, portable typed binds, and cross-dialect type planning.

The model is intentionally conservative. Unknown or vendor-specific types remain native rather than being guessed into a portable family.

## Canonical families

The current released families are:

- boolean
- signed/unsigned integer intent (`int16`, `int32`, `int64`)
- exact decimal
- single/double precision floating point
- text
- binary
- UUID/GUID
- JSON
- date
- time
- timestamp
- array
- native/vendor-specific fallback

Canonical descriptors can carry precision, scale, length, timezone and unsigned intent.

```js
const type = sql.canonicalType('postgresql', 'numeric(26,6)');

console.log(type);
```

## Typed bind integration

Portable typed-value specifications resolve into the same canonical model:

```js
const canonical = sql.canonicalTypeFromPortableSpec({
  type: 'decimal',
  precision: 26,
  scale: 6
});
```

This means bind intent and metadata type analysis share one semantic vocabulary.

## Target mapping decisions

`nativeTypeMapping()` returns both a target type and an explicit decision.

Decision values are:

- `native-equivalent` — the target engine has a directly corresponding native type.
- `lossless-map` — a different target type preserves the canonical value domain.
- `lossy-map` — the mapping cannot preserve the full canonical semantics or value domain.
- `application-convention` — correctness depends on a NuBloxSQL/application storage convention rather than a dedicated native database type.
- `runtime-qualified` — more runtime/type detail is required before a safe target can be selected.
- `unsupported` — NuBloxSQL has no defensible released mapping.

Do not treat `application-convention` as native equivalence.

## Compatibility planning

Use `typeCompatibility()` to infer the source native type and immediately evaluate a target dialect:

```js
const result = sql.typeCompatibility('postgresql', 'sqlserver', 'uuid');
```

## Metadata annotation

Canonical type analysis can be applied to a portable metadata snapshot:

```js
const snapshot = await db.introspect({ deep: true });
const types = sql.annotateTypes(snapshot);
```

This keeps portable metadata vocabulary v1 stable while adding a separate semantic projection.

## Important portability boundaries

### Exact decimals

The released mapping respects current engine precision limits:

- PostgreSQL explicit `NUMERIC` precision: up to 1000.
- MySQL `DECIMAL`: up to 65 digits.
- SQL Server `DECIMAL`: up to 38 digits.
- SQLite does not provide rigid exact-decimal storage semantics; NuBloxSQL uses a text convention when exact decimal preservation is required.

### Unsigned integers

PostgreSQL and SQL Server do not have a native unsigned `BIGINT` equivalent. NuBloxSQL maps unsigned 64-bit intent to exact decimal types where the full range can be preserved.

SQLite signed INTEGER can preserve unsigned 16-bit and 32-bit domains, but not the complete unsigned 64-bit range.

### Temporal precision

NuBloxSQL reports precision loss instead of silently clamping it:

- PostgreSQL released time/timestamp mapping: maximum 6 fractional digits.
- MySQL `TIME`, `DATETIME`, and `TIMESTAMP`: maximum 6 fractional digits.
- SQL Server `TIME`, `DATETIME2`, and `DATETIMEOFFSET`: maximum 7 fractional digits.

### Time zones

A canonical timestamp with offset/timezone semantics does not map losslessly to MySQL `TIMESTAMP`, because MySQL normalizes through session time-zone behavior and does not preserve arbitrary original offsets.

### SQLite

SQLite uses storage classes and affinity rather than rigid per-column types. Boolean, UUID, JSON and temporal mappings are therefore represented as application conventions unless a stronger guarantee can be proven.

## Vendor-specific types

Unknown types are returned as `family: 'native'` with the native type retained. NuBloxSQL deliberately does not infer equivalence for extension, domain, spatial, enum, range, geometry or user-defined types until those families have explicit semantics.

## Reference limits

- PostgreSQL numeric types: https://www.postgresql.org/docs/current/datatype-numeric.html
- MySQL exact numeric types: https://dev.mysql.com/doc/refman/8.4/en/fixed-point-types.html
- SQL Server precision/scale: https://learn.microsoft.com/en-us/sql/t-sql/data-types/precision-scale-and-length-transact-sql
- SQLite datatype/affinity model: https://www.sqlite.org/datatype3.html
