# NuBloxSQL User Guides

These guides document the released NuBloxSQL 1.1.x public surface. Use them with the [support matrix](../SUPPORT.md), [public API](../API.md), and [release status](../RELEASE.md).

## Core runtime

1. [Getting started](01-getting-started.md)
2. [Connections and pooling](02-connections-and-pooling.md)
3. [SQL, parameters and typed values](03-sql-parameters-and-types.md)
4. [Prepared statements and result APIs](04-prepared-and-results.md)
5. [Transactions and savepoints](05-transactions.md)
6. [Streaming and operation control](06-streaming-and-operation-control.md)
7. [Metadata and introspection](07-metadata-and-introspection.md)
8. [Errors, retries and recovery](08-errors-retries-and-recovery.md)
9. [Observability and type codecs](09-observability-and-type-codecs.md)
10. [Dialect guide](10-dialects.md)
11. [Capabilities and SQL portability](11-capabilities-and-portability.md)
12. [TypeScript guide](12-typescript.md)
13. [Production operation and troubleshooting](13-production-and-troubleshooting.md)

## Engineering and portability

14. [DDL compiler](14-ddl-compiler.md)
15. [Canonical type semantics](15-canonical-type-semantics.md)
16. [Canonical schema snapshots](16-canonical-schema-snapshots.md)
17. [Canonical schema diff](17-canonical-schema-diff.md)
18. [Migration planner](18-migration-planner.md)
19. [Migration execution engine](19-migration-execution-engine.md)
20. [Data movement](20-data-movement.md)
21. [Canonical dialect registry](21-dialect-registry.md)
22. [Dialect profile capability overlays](22-profile-capability-overlays.md)
23. [MariaDB profile over MySQL](23-mariadb-profile.md)

## Administration and engine lifecycle

25. [Database bootstrap foundation](25-database-bootstrap.md)
26. [Database configuration](26-database-configuration.md)
27. [Engine lifecycle foundation](27-engine-lifecycle-foundation.md)
28. [Controlled engine lifecycle execution](28-engine-lifecycle-execution.md)
29. [Local host lifecycle inspection provider](29-local-host-lifecycle-provider.md)

The numbering reflects the historical delivery order; missing numbers are intentionally not fabricated.

## Documentation rules

- Guides describe released APIs and supported behaviour only.
- Engine-specific behaviour remains explicit and must not be assumed portable.
- Current guides must not depend on archived documentation.
- Product direction belongs in [the Product Blueprint](../product/BLUEPRINT.md), not in user guides.
