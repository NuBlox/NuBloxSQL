# NuBloxSQL v1.0.0 Release Plan and Completion Record

> **Historical release record:** this document records the completed path to NuBloxSQL v1.0.0. Current forward development is maintained in `../../NUBLOX-SQL-ROADMAP.md`.

## Release outcome

NuBloxSQL v1.0.0 established a stable, independently releasable, proprietary SQL driver baseline using Node.js built-ins and NuBlox-authored source.

Stable package set:

```text
@nublox/sql-core@1.0.0
@nublox/mysql@1.0.0
@nublox/postgresql@1.0.0
```

SQLite, SQL Server and Oracle were intentionally outside the v1.0.0 stable release boundary.

## Completed gates

### Gate 1 — MySQL clean-room production surface — COMPLETE

See `GATE-1-EVIDENCE.md`.

The completed MySQL baseline includes native connectivity/TLS/authentication, queries, prepared statements, transactions/savepoints, bounded pooling, streaming/backpressure, session reset, resource limits, operation controls, deterministic errors, observability and live MySQL qualification.

### Gate 2 — Canonical MySQL replacement — COMPLETE

The NuBlox-authored implementation replaced the historical mysqljs-derived runtime in the current canonical `packages/mysql` package. Historical Git history remains historical evidence and is not represented as original NuBlox authorship.

### Gate 3 — PostgreSQL production hardening — COMPLETE

See `GATE-3-EVIDENCE.md`.

The completed PostgreSQL baseline includes native simple and extended query protocols, prepared execution, race-safe CancelRequest cancellation, bounded pooling, transactions/savepoints, native portals/cursors, result limits, deterministic lossless type policy, TLS/authentication negative-path coverage and PostgreSQL 15–18 qualification.

### Gate 4 — SQL Core contract family 1.0 — COMPLETE

See `GATE-4-EVIDENCE.md` and `SQL-CORE-V1-CONTRACT.md`.

SQL Core freezes only portable concepts proven by the stable MySQL and PostgreSQL adapters. Breaking changes to contract family `1.0` require a new major version.

### Gate 5 — Proprietary and stable release audit — COMPLETE

See `GATE-5-EVIDENCE.md`, `V1-RELEASE-NOTES.md`, `V1-MIGRATION.md` and `V1-SUPPORT-MATRIX.md`.

The completed gate established:

- NuBloxSQL Proprietary Software Licence;
- copyright 2026 Stephen J T Spittal;
- historical-licence preservation for validly distributed historical copies;
- stable `1.0.0` package manifests;
- zero declared third-party npm runtime/development/optional/peer dependencies;
- lockfile-free v1 release boundary;
- proprietary and stable-release audits;
- package dry-run verification;
- Node.js 22/24/26 qualification;
- MySQL 8.4/9.7 qualification;
- PostgreSQL 15/16/17/18 qualification;
- protocol/resource regression gates, fuzzing and CodeQL;
- release notes, migration guidance and support matrix.

## Stable support baseline

See `V1-SUPPORT-MATRIX.md` for the authoritative v1.0.0 matrix.

## Proprietary release boundary

The v1 release line is governed by the repository/package `LICENSE` files. Public availability does not grant an open-source licence.

Historical versions or copies validly distributed under earlier licence terms retain the rights granted for those historical copies.

## Post-v1 policy established by v1

The v1 release established these ongoing rules:

- preserve SQL Core contract-family compatibility within major version 1;
- keep vendor-specific semantics first class in adapters;
- require future stable dialects to meet equivalent testing, security, provenance and support-evidence standards;
- avoid reintroducing third-party implementation dependencies without an explicit product, security and licensing decision;
- keep `main` releasable through focused branches and pull requests.

## Completion state

All five v1 gates were completed and merged. The stable v1.0.0 baseline is therefore a historical release state, not an active release-candidate plan.

Authenticated package publication and other distribution-channel actions are operational release activities separate from this technical completion record.
