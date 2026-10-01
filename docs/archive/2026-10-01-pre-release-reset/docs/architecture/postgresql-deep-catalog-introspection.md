# PostgreSQL deep catalog introspection

NuBloxSQL exposes PostgreSQL-native catalog detail through the existing `client.metadata` / `client.catalog` surface. The portable catalog remains unchanged; these methods add PostgreSQL-specific depth without flattening vendor semantics.

## API

```js
const table = await db.metadata.tableDetails('orders', { schema: 'public' });
const columns = await db.metadata.columnDetails('orders', { schema: 'public' });
const indexes = await db.metadata.indexDetails('orders', { schema: 'public' });
const constraints = await db.metadata.constraintDetails('orders', { schema: 'public' });

const partitions = await db.metadata.partitions({ schema: 'public' });
const policies = await db.metadata.policies({ schema: 'public' });
const routines = await db.metadata.routines({ schema: 'public' });
const types = await db.metadata.types({ schema: 'public' });
const sequences = await db.metadata.sequences({ schema: 'public' });
const privileges = await db.metadata.privileges({ schema: 'public' });

const catalog = await db.metadata.deepCatalog({ schema: 'public' });
```

All returned arrays and top-level records are frozen. Raw catalog rows remain available under `native`.

## Table and column detail

`tableDetails()` reports PostgreSQL relation kind, persistence, owner, tablespace, row-level-security state, partition key/bound, replica identity, planner row/page estimates and comments.

`columnDetails()` reports formatted/native type identity, nullability, identity generation (`always` / `by-default`), generated-column kind and expression, backing sequence, collation, storage/compression policy, statistics target and comments.

## Index and constraint detail

`indexDetails()` preserves PostgreSQL-specific index semantics including method, uniqueness, exclusion, clustering, validity/readiness/liveness, replica-identity role, `NULLS NOT DISTINCT`, key/include attribute counts, expression text, partial-index predicate, definition, tablespace and comments.

`constraintDetails()` reports primary, unique, foreign-key, check, exclusion and constraint-trigger kinds with deferrability, initial deferred state, validation, inheritance and native definition.

## Partitioning and row-level security

`partitions()` exposes parent/child topology, partition key and native partition bounds.

`policies()` exposes PostgreSQL RLS policy command, permissive/restrictive semantics, target roles, `USING` expression and `WITH CHECK` expression.

## Routines

`routines()` covers functions, procedures, aggregates and window routines. It returns identity arguments, full argument list, result type, language, owner, volatility, strictness, security-definer/leakproof flags, parallel safety, cost/row estimates, configuration and source definition where PostgreSQL can provide one.

## Types

`types()` covers user-defined composite, domain, enum, range and multirange types. Enum labels are returned in sort order. Domain constraints remain attached to the type. Range subtype and multirange relationships are preserved.

## Sequences and privileges

`sequences()` reports owner, type, start/min/max, increment, cycle, cache and last visible value from `pg_catalog.pg_sequences`.

`privileges()` combines visible table, routine and usage privileges from `information_schema`. It reflects what PostgreSQL exposes to the current role; it is not an impersonation or superuser audit API.

## Qualification

The live PostgreSQL workflow qualifies the surface on PostgreSQL 15, 16, 17 and 18. Qualification creates and discovers:

- identity and stored generated columns;
- partial expression indexes;
- partitioned tables and native partition bounds;
- row-level-security policies;
- user-defined enum and domain types;
- routines;
- sequences;
- explicit table privileges.

The feature is additionally covered by the Node 22/24/26 PostgreSQL contract suite and the repository-wide release/security gates.
