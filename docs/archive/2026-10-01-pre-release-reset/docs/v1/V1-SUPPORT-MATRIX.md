# NuBloxSQL v1.0.0 Support Matrix

> **Release record:** this document defines the stable NuBloxSQL v1.0.0 qualification baseline. Post-v1 development packages are documented separately and do not change this matrix.

## Stable package set

| Package | Version | Status |
| --- | ---: | --- |
| `@nublox/sql-core` | `1.0.0` | Stable |
| `@nublox/mysql` | `1.0.0` | Stable |
| `@nublox/postgresql` | `1.0.0` | Stable |

## Node.js

NuBloxSQL v1.0.0 is qualified on:

- Node.js 22
- Node.js 24
- Node.js 26

The release and contract gates execute across all three supported majors.

## MySQL

`@nublox/mysql@1.0.0` is qualified against:

- MySQL 8.4
- MySQL 9.7

The stable surface includes native connectivity/TLS, supported authentication flows, simple queries, prepared statements, transactions/savepoints, bounded pooling/session reset, streaming/backpressure, result limits, timeout/deadline/AbortSignal controls, TypeScript declarations and deterministic NuBlox client/server errors.

## PostgreSQL

`@nublox/postgresql@1.0.0` is qualified against:

- PostgreSQL 15
- PostgreSQL 16
- PostgreSQL 17
- PostgreSQL 18

The stable surface includes native TCP/TLS, supported authentication paths including SCRAM-SHA-256, simple and extended query protocols, prepared statements, parameterized execution, CancelRequest cancellation, bounded pooling, transactions/savepoints, server-side portals/cursors, bounded results and deterministic lossless type decoding.

## SQL Core

`@nublox/sql-core@1.0.0` exposes contract family `1.0`. The frozen portable surface is defined in `SQL-CORE-V1-CONTRACT.md` and proven against the stable MySQL and PostgreSQL v1 adapters.

## Post-v1 packages

`@nublox/sqlite@0.1.0` is a development package and is **not** part of the stable v1.0.0 matrix. Its current minimum runtime is Node.js 22.16.0.

SQL Server and Oracle are planned and have no stable support claim.

## Dependency boundary

The stable v1 packages declare no third-party npm runtime, development, optional or peer dependencies. Production implementation uses Node.js built-ins and NuBlox-authored source.

## Qualification rule

A runtime/database combination is supported by v1.0.0 only when it is represented by this maintained release matrix. Other environments may work but are not part of the v1.0.0 qualification claim.
