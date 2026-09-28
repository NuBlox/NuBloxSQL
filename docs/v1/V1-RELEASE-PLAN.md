# NuBloxSQL v1.0.0 Release Plan

This document records the completed delivery path to NuBloxSQL v1.0.0.

## Release objective — COMPLETE

NuBloxSQL v1.0.0 is a stable, production-grade, independently releasable SQL driver platform whose shipped implementation is NuBlox-authored proprietary intellectual property.

The v1 release boundary uses Node.js built-ins and NuBlox-authored source only. No copied or forked third-party implementation source and no third-party npm runtime/build/test dependency is required to produce or validate the v1 release artifacts.

External database servers, published protocol specifications, operating systems, Node.js and hosting/CI infrastructure are interoperability targets or infrastructure; they are not bundled NuBloxSQL implementation dependencies.

## Stable v1 package set

```text
@nublox/sql-core@1.0.0
@nublox/mysql@1.0.0
@nublox/postgresql@1.0.0
```

SQLite, SQL Server, Oracle and additional dialects are deferred to later releases and must independently satisfy NuBloxSQL quality and proprietary gates.

## Completed gates

### Gate 1 — Clean-room MySQL feature parity — COMPLETE

See `GATE-1-EVIDENCE.md`.

The production baseline includes native connection/TLS/authentication, simple queries, prepared statements, typed parameters/results, transactions/savepoints, bounded pooling, timeouts/deadlines/AbortSignal, deterministic cleanup, stable errors, streaming/backpressure, session reset, resource limits, observability and live MySQL validation.

### Gate 2 — Replace legacy `@nublox/mysql` — COMPLETE

The NuBlox-authored implementation was promoted to canonical `packages/mysql` / `@nublox/mysql`. The historical mysqljs-derived source tree, transitional package, inherited lineage files and historical third-party package dependency graph were removed from the current v1 source/package boundary.

Historical Git history remains historical evidence and is not represented as original NuBlox authorship.

### Gate 3 — PostgreSQL v1 hardening — COMPLETE

See `GATE-3-EVIDENCE.md`.

The PostgreSQL v1 baseline includes native simple/extended protocols, prepared execution, CancelRequest cancellation, pooling, transactions/savepoints, native portal cursors, result/resource limits, deterministic lossless type policy, TLS/authentication negative paths, live PostgreSQL 15–18 validation and production performance/resource evidence.

### Gate 4 — Stabilise SQL Core — COMPLETE

See `GATE-4-EVIDENCE.md` and `SQL-CORE-V1-CONTRACT.md`.

SQL Core contract family `1.0` freezes only portable concepts proven by both canonical adapters: dialect identity/capabilities, identifier/placeholder services, structural cancellation, relative timeout policy, bounded results, positional execution, row/command result vocabulary, transaction policy, portable error categorisation and adapter extension points.

Unproven generic named parameters, generic multi-result containers and universal absolute deadlines were deliberately excluded.

Breaking changes to the frozen SQL Core v1 contract require a new major version.

### Gate 5 — Proprietary and stable release audit — COMPLETE

See `GATE-5-EVIDENCE.md`, `V1-RELEASE-NOTES.md`, `V1-MIGRATION.md` and `V1-SUPPORT-MATRIX.md`.

Gate 5 establishes:

- NuBloxSQL Proprietary Software Licence for the current v1 release line;
- copyright 2026 Stephen J T Spittal, all rights reserved;
- explicit preservation of valid historical licence grants for historical copies;
- stable `1.0.0` package manifests;
- zero declared third-party npm runtime/development/optional/peer dependencies;
- no dependency lockfile in the v1 release boundary;
- proprietary audit passing with zero blockers;
- stable-release audit passing;
- clean package dry-runs for all three publishable packages;
- Node.js 22/24/26 verification;
- live MySQL 8.4/9.7 validation;
- live PostgreSQL 15/16/17/18 validation;
- protocol/resource regression gates, fuzzing and CodeQL green;
- release notes, migration guidance and support matrix complete.

## Stable support baseline

### Node.js

- 22
- 24
- 26

### MySQL

- 8.4
- 9.7

### PostgreSQL

- 15
- 16
- 17
- 18

See `V1-SUPPORT-MATRIX.md` for details.

## Proprietary release boundary

The current v1 line is governed by the repository/package `LICENSE` files. Public availability does not grant an open-source licence.

Historical versions or commits that were validly distributed under earlier licence terms retain the rights validly granted for those historical copies. The v1 proprietary licence governs copies expressly distributed under the v1 terms.

## Post-v1 development policy

After the stable v1 baseline:

- preserve SQL Core contract-family compatibility within major version 1;
- keep vendor-specific semantics first class in adapters;
- require new dialects to satisfy the same proprietary, testing, security and support-evidence standard before stable release;
- do not reintroduce third-party implementation dependencies into the v1 package boundary without an explicit product/licensing decision;
- use focused feature branches/PRs and keep `main` releasable.

## Release decision

All five NuBloxSQL v1 technical/provenance gates are complete on the final-release branch. The branch is eligible to merge only after the final documentation-inclusive CI matrix remains green.

After merge, `main` is the stable NuBloxSQL v1.0.0 source baseline. npm publication and other distribution-channel publication are separate authenticated release actions.
