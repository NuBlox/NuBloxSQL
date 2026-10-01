# NuBloxSQL SQL Capability Model

## Purpose

The SQL Capability Model is the machine-readable semantic layer above NuBloxSQL dialect drivers. It describes what a database can express, how it expresses it, and whether the capability is native, equivalent, emulated, partial, runtime-dependent, unsupported, unknown, or not applicable.

The first-class Tier-1 dialects are PostgreSQL, MySQL and SQLite. SQL Server remains a supported NuBloxSQL runtime dialect but is intentionally outside the exhaustive Tier-1 capability programme at this stage.

## Model categories

Every Tier-1 model has the same required categories:

- `statements`
- `queries`
- `schema`
- `expressions`
- `integrity`
- `physical`
- `security`
- `transactions`
- `programmability`
- `administration`
- `dataMovement`
- `extensions`
- `types`
- `functions`
- `operators`
- `keywords`
- `syntax`
- `limits`

## Capability entries

A leaf capability is not a boolean. Its stable schema-v1 shape records support level, native naming, version provenance, syntax, standards alignment, evidence references, restrictions, aliases, equivalents and notes.

`null` support means the answer cannot be determined statically and must be established from runtime/server evidence.

## Public API

```js
const sql = require('nubloxsql');

const pg = sql.capabilityModel.dialect('postgresql');
const lateral = sql.capabilityModel.status('postgresql', 'queries.joins.lateral');
const supported = sql.capabilityModel.supports('mysql', 'queries.joins.lateral');
const comparison = sql.capabilityModel.compare('queries.joins.lateral');
```

`compare()` answers whether a capability is statically portable across a selected dialect set.

## Compatibility analysis

M5 adds directional compatibility analysis. This is deliberately more conservative than a boolean feature comparison because migration and translation depend on source and target semantics.

```js
const result = sql.capabilityModel.compatibility(
  'postgresql',
  'sqlite',
  'queries.joins.lateral'
);
```

A compatibility result includes:

- `compatible`: `true`, `false` or `null` when runtime evidence is required.
- `level`: `exact`, `equivalent`, `emulated`, `partial`, `runtime-dependent`, `unsupported`, `not-applicable`, `source-unavailable` or `unknown`.
- `rewriteRequired`: whether syntax/semantic rewriting is expected.
- `lossless`: `true`, `false` or `null` when it cannot yet be guaranteed.
- `reasons`: machine-readable diagnostic reasons.
- the complete source and target capability entries used as evidence.

This does not yet rewrite SQL. It establishes whether a future rewrite engine has a sound semantic target.

## Category comparison

```js
const schema = sql.capabilityModel.compareCategory('schema');
```

The result contains the union of modeled feature paths for the category and one row per path across PostgreSQL, MySQL and SQLite. Each row reports whether the feature is universally supported and whether the answer is statically determinate.

Feature paths can also be enumerated directly:

```js
const paths = sql.capabilityModel.paths('queries');
```

## Migration surface

`migrationSurface()` builds a directional inventory of every source capability that is actually available and classifies its target compatibility:

```js
const report = sql.capabilityModel.migrationSurface(
  'postgresql',
  'mysql',
  'queries'
);
```

The report includes counts for exact, equivalent, emulated, partial, runtime-dependent, unsupported, not-applicable and unknown target outcomes plus the full per-capability evidence.

The report is an analysis primitive rather than an automatic migration verdict. It deliberately does not assign a simplistic compatibility percentage because unsupported capabilities differ greatly in business and semantic importance.

## Coverage status

Tier-1 capability coverage is now `exhaustive-v1` for:

1. PostgreSQL.
2. MySQL.
3. SQLite, including version-, compile- and host-runtime-dependent capabilities.

The programme sequence is:

1. **M1 — complete:** model schema and public API.
2. **M2 — complete:** exhaustive-v1 PostgreSQL map.
3. **M3 — complete:** exhaustive-v1 MySQL map.
4. **M4 — complete:** exhaustive-v1 SQLite map.
5. **M5 — current:** comparison and directional compatibility analysis.
6. M6 — version-aware runtime qualification.
7. M7 — rewrite/compatibility engine.
8. M8 — AST/parser/compiler architecture.

## Design rules

1. Preserve native semantics. Do not mark a capability unsupported merely because another dialect uses different syntax.
2. Keep static knowledge separate from runtime evidence.
3. Prefer `equivalent` over pretending two different native constructs are identical.
4. Prefer `partial` when a construct has material semantic restrictions.
5. Use `not-applicable` for server concepts SQLite intentionally does not have, such as database users and grants.
6. Unknown is preferable to an unverified claim.
7. Capability and compatibility data is deeply frozen and safe for shared use.
8. Direction matters: PostgreSQL-to-SQLite compatibility is not assumed to equal SQLite-to-PostgreSQL compatibility.
9. Compatibility analysis must not claim losslessness where the capability model has only equivalence, emulation or runtime-dependent evidence.
10. Legacy `descriptor.supports()` remains intact. The SQL Capability Model is a richer layer, not a breaking replacement.

## Evidence policy

Each Tier-1 model carries a primary-source evidence register and each significant capability leaf includes references. Compatibility analysis consumes those modeled facts rather than introducing a second independent database knowledge base.
