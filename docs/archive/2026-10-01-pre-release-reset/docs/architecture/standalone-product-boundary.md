# NuBloxSQL Standalone Product Boundary

## Product boundary

NuBloxSQL is a standalone SQL/database platform for application developers.

Its dependency direction is one-way:

```text
developer application
        ↓
     NuBloxSQL
        ↓
SQL database engine
```

NuBloxSQL must not know which application consumes it. It must not contain application-specific concepts, integration assumptions, object models, workflows, UI concerns, ORM concerns, or product-specific contracts.

A consumer may be a web application, CLI, service, IDE, ORM, migration tool, analytics product, desktop application, test harness, or a product that does not yet exist. Those consumers are outside NuBloxSQL's architecture.

## End vision

NuBloxSQL should be the SQL/database layer a JavaScript or TypeScript developer does not need to replace when moving among supported database engines.

The finished platform combines:

1. exceptional native database runtimes;
2. one coherent public API;
3. lossless type and result handling;
4. transaction, streaming, cancellation and resource-control contracts;
5. deep metadata and schema introspection;
6. structured errors, diagnostics and observability;
7. machine-readable database capability intelligence;
8. runtime/version capability qualification;
9. structural SQL understanding where NuBloxSQL can prove semantics;
10. safe compatibility and transformation tooling that fails closed when semantics are uncertain.

The current Tier-1 product focus is PostgreSQL, MySQL and SQLite.

## Runtime layer

Each Tier-1 engine retains its native strengths and semantics.

### PostgreSQL

NuBloxSQL should expose first-class PostgreSQL behaviour including protocol/authentication/TLS, extended query protocol, prepared statements, portals, COPY, notifications, transactions, cancellation, pooling, PostgreSQL types, metadata and diagnostics.

### MySQL

NuBloxSQL should expose first-class MySQL behaviour including native protocol/authentication/TLS, prepared execution, streaming, bulk data movement, transactions, pooling, cancellation/operation control, MySQL types, metadata and diagnostics.

### SQLite

NuBloxSQL should expose first-class embedded SQLite behaviour including prepared execution, transactions/savepoints, WAL/storage policy, backup/serialization, attached databases, maintenance, extensions/functions, changesets, metadata, diagnostics and resource governance.

## Public platform layer

The public platform provides a consistent developer vocabulary where the engines genuinely share semantics:

```js
const sql = require('nubloxsql');
const db = sql.createClient({ dialect: 'postgresql', ...config });

await db.query(...);
await db.execute(...);
await db.prepare(...);
await db.transaction(...);
await db.introspect(...);
await db.close();
```

Dialect-native functionality remains available from the same installation. NuBloxSQL must not hide useful native power to make engines look artificially identical.

## Intelligence layer

NuBloxSQL may understand SQL/database semantics because that knowledge belongs to the SQL platform itself.

This includes:

- what a database engine supports;
- what a connected server/runtime actually supports;
- schema/catalog structure;
- SQL statement structure;
- compatibility differences between supported engines;
- whether a transformation can be proven safe;
- diagnostics and execution-plan information.

This intelligence remains database-focused and application-agnostic.

## Non-goals and prohibited coupling

NuBloxSQL must not depend on or contain knowledge of:

- any ORM;
- any database workbench or IDE;
- any NuBlox application outside this repository;
- any customer's application model;
- business-domain objects or workflows;
- UI/navigation concepts;
- application-specific persistence conventions.

Those systems may depend on NuBloxSQL. NuBloxSQL must never depend on them.

## Success condition

NuBloxSQL succeeds when an independent developer can choose it purely on its own merits as a production SQL/database platform, use one dependency across supported engines, retain native database power, and gain database intelligence without accepting application-specific coupling.
