# Migrating to NuBloxSQL v1.0.0

NuBloxSQL v1 is a clean production baseline, not a compatibility continuation of every pre-v1 experiment.

## Package versions

Migrate to the stable package set together where practical:

```text
@nublox/mysql@1.0.0
@nublox/postgresql@1.0.0
@nublox/sql-core@1.0.0
```

## MySQL

The v1 `@nublox/mysql` package is the NuBlox-authored native implementation that replaced the historical mysqljs-derived source tree.

Applications should validate their use of:

- `createConnection()` / `createPool()`;
- Promise-based query and prepared-statement flows;
- transaction/savepoint helpers;
- streaming APIs and result limits;
- timeout/deadline/AbortSignal behavior;
- pool reset-on-release behavior;
- v1 error codes and SQLSTATE/native server error preservation.

Do not assume every historical mysqljs-compatible or experimental pre-v1 API exists in v1. Features not required for the v1 production baseline were deliberately deferred rather than retaining legacy source.

## PostgreSQL

The v1 PostgreSQL package promotes the native driver line to stable `1.0.0`. Applications using the earlier `0.2.0-rc.*` line should re-run integration tests around:

- simple versus parameterized/extended execution;
- prepared-statement lifecycle;
- CancelRequest cancellation;
- pool reset/reuse;
- transaction/savepoint handling;
- portal/cursor batching;
- lossless type policy (`int8` as `bigint`, arbitrary-precision `numeric` as `string`, timezone-less timestamp types as strings);
- configured result limits.

## SQL Core

SQL Core v1 deliberately removes prototype abstractions that were not proven by both production adapters.

The portable v1 contract does **not** include:

- named parameter maps;
- generic multi-result containers;
- universal absolute deadlines;
- vendor cursor/portal wire models;
- CDC/replication APIs.

Portable operation control uses relative `timeout` plus a structural cancellation signal. MySQL may expose absolute deadlines as an adapter-specific extension.

## Licensing

NuBloxSQL v1.0.0 is distributed under the NuBloxSQL Proprietary Software Licence in the repository/package `LICENSE` files. Public availability does not grant an open-source licence.

Historical copies that were validly distributed under earlier licence terms remain governed by those historical grants; the v1 proprietary licence governs copies expressly distributed under the v1 terms.

## Upgrade validation

Before production deployment:

1. upgrade all NuBloxSQL packages used by the application;
2. run the application's database integration suite against its exact MySQL/PostgreSQL server versions;
3. exercise cancellation, transaction rollback, pooling/reset and large-result paths;
4. verify TypeScript/build integration if declarations are consumed;
5. review `V1-SUPPORT-MATRIX.md` for the qualified runtime/server matrix.
