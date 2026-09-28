# NuBloxSQL v1.0.0 Support Matrix

## Runtime

NuBloxSQL v1.0.0 supports Node.js 22, 24 and 26. The release gates execute the package and contract suites on all three supported Node majors.

## MySQL

`@nublox/mysql@1.0.0` is validated against:

- MySQL 8.4
- MySQL 9.7

The supported v1 surface includes native connectivity/TLS, supported MySQL authentication flows, simple queries, prepared statements, transactions/savepoints, bounded pooling/session reset, streaming/backpressure, result limits, timeout/deadline/AbortSignal controls, TypeScript declarations and the NuBlox client/server error model.

Capabilities reported by the adapter describe implemented driver behavior rather than every feature that a MySQL server may support.

## PostgreSQL

`@nublox/postgresql@1.0.0` is validated against:

- PostgreSQL 15
- PostgreSQL 16
- PostgreSQL 17
- PostgreSQL 18

The supported v1 surface includes native TCP/TLS, SCRAM and compatibility authentication paths, simple and extended query protocols, prepared statements, parameterized execution, CancelRequest cancellation, bounded pooling, transactions/savepoints, server-side portals/cursors, bounded result limits and deterministic lossless type decoding.

## SQL Core

`@nublox/sql-core@1.0.0` exposes contract family `1.0`. Its frozen portable surface is defined in `SQL-CORE-V1-CONTRACT.md` and is proven against the canonical MySQL and PostgreSQL v1 adapters.

## Deferred dialects

SQLite, SQL Server and Oracle are not part of the stable NuBloxSQL v1.0.0 support matrix. They are intentionally deferred until after the three-package v1 baseline is released and must independently satisfy NuBloxSQL quality and proprietary gates before becoming supported packages.

## Dependency boundary

The v1 packages declare no third-party npm runtime, development, optional or peer dependencies. Production implementation uses Node.js built-ins and NuBlox-authored source only.

## Release qualification

A database/Node combination is considered supported only when it is represented by the maintained CI matrix or subsequently added through a documented support update. Environments outside this matrix may work but are not part of the v1 release qualification claim.
