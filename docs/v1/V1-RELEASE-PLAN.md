# NuBloxSQL v1.0.0 Release Plan

This document is the single authoritative development path from the current repository state to NuBloxSQL v1.0.0.

## Release objective

NuBloxSQL v1.0.0 is a stable, production-grade, independently releasable SQL driver platform whose shipped implementation is NuBlox-authored proprietary intellectual property.

The v1 release boundary uses Node.js built-ins and NuBlox-authored source only. No copied or forked third-party implementation source and no third-party npm runtime/build/test dependency may be required to produce or validate the v1 release artifacts.

External database servers, published protocol specifications, operating systems, Node.js and hosting/CI infrastructure are interoperability targets or infrastructure; they are not bundled NuBloxSQL implementation dependencies.

## Current authoritative state

### SQL Core

`@nublox/sql-core` is the shared cross-dialect contract layer. Keep it deliberately small until the two production adapters prove a portable concept is genuinely shared.

### MySQL

Gate 1 clean-room MySQL feature parity is complete. The evidence record is `docs/v1/GATE-1-EVIDENCE.md`.

There are currently two MySQL implementations during the Gate 2 replacement:

1. `packages/mysql` — legacy mastered implementation derived from mysqljs/mysql. It remains only as a behavioural and compatibility baseline during migration and is not eligible for proprietary v1.
2. `packages/mysql-cleanroom` — NuBlox-authored zero-package-dependency replacement. Gate 1 has validated this implementation as the production replacement candidate and Gate 2 now promotes it to the v1 `@nublox/mysql` package.

### PostgreSQL

`@nublox/postgresql` is a NuBlox-authored native driver with no npm package dependencies. It currently provides native TCP/TLS connectivity, SCRAM authentication and simple-query execution. Treat it as stable-in-development while the MySQL replacement and repository-wide proprietary gates are completed.

### Future dialects

SQLite, SQL Server, Oracle and additional dialects are deferred until the v1 foundation below is complete. They must not create parallel implementation streams before the release baseline is clean.

## Single critical path

Development proceeds in this order only.

### Gate 1 — Clean-room MySQL feature parity — COMPLETE

Gate 1 is complete. See `docs/v1/GATE-1-EVIDENCE.md` for the implementation and validation record.

The production surface validated before closure includes:

- connection lifecycle and TLS
- caching_sha2_password and supported authentication paths
- simple query execution
- prepared statements and typed parameters/results
- transactions and savepoints
- bounded connection pooling
- timeout and AbortSignal semantics
- deterministic resource cleanup
- TypeScript declaration surface without requiring TypeScript as a release dependency
- error model and SQLSTATE/native-code preservation
- streaming/backpressure where required for production workloads
- session reset/state behaviour required by pooling
- observability implemented with Node/NuBlox primitives only
- live MySQL version matrix

Features from the legacy driver that are not required for v1 stability are explicitly deferred rather than keeping legacy source alive indefinitely.

### Gate 2 — Replace legacy `@nublox/mysql` — ACTIVE

When clean-room parity gates pass:

1. promote `packages/mysql-cleanroom` to `packages/mysql` and package name `@nublox/mysql`;
2. remove the mysqljs-derived implementation from the v1 source tree;
3. remove `NUBLOX-UPSTREAM.json`, mastered-package lineage metadata and third-party notices that are no longer applicable to the shipped implementation;
4. remove runtime dependencies such as `bignumber.js`, `named-placeholders`, `safe-buffer` and `sqlstring`;
5. remove development dependencies used solely by the legacy package (`mysql2`, legacy test runners, ESLint/TypeScript tooling and related transitive packages) or replace their release-gating purpose with NuBlox/Node-built-in checks;
6. regenerate the workspace lockfile so the v1 release boundary contains no package dependency graph.

Historical Git history is historical evidence and is not rewritten or represented as original NuBlox authorship. The v1 shipped source must itself satisfy the proprietary gate.

### Gate 3 — PostgreSQL v1 hardening

After MySQL replacement:

- extended query protocol (Parse/Bind/Describe/Execute/Sync)
- prepared statements and typed parameters
- cancellation using PostgreSQL CancelRequest
- bounded pooling and transaction helpers aligned with SQL Core policy
- streaming/portal behaviour required for production use
- robust type decoding for the supported v1 matrix
- TLS/authentication failure-path hardening
- live supported PostgreSQL version matrix
- performance/resource-limit tests

Do not add PostgreSQL features merely to mirror MySQL; preserve first-class PostgreSQL semantics.

### Gate 4 — Stabilise SQL Core

Only after MySQL and PostgreSQL both implement the concept:

- freeze v1 execution/result contracts;
- freeze transaction/cancellation semantics;
- freeze error categorisation rules;
- freeze metadata/type extension points;
- keep vendor-only capabilities in adapters;
- reject lowest-common-denominator abstractions.

### Gate 5 — Proprietary and release audit

`npm run v1:proprietary-audit` becomes mandatory and must pass with zero findings.

Required release evidence:

- no third-party implementation source in shipped packages;
- no third-party npm dependencies required by shipped/runtime/build/test/release boundary;
- no legacy lineage markers in current v1 package manifests;
- proprietary NuBlox licence applied consistently to v1 source and packages;
- package manifests at `1.0.0`;
- clean pack manifests for every publishable package;
- deterministic Node-supported test matrix;
- live MySQL and PostgreSQL integration matrices green;
- security/resource-limit/fuzz regression gates green;
- compatibility/migration notes for pre-v1 users;
- release notes and support matrix complete.

## v1 package scope

The stable v1 release initially contains only packages that meet the full quality and proprietary gates:

```text
@nublox/sql-core@1.0.0
@nublox/mysql@1.0.0
@nublox/postgresql@1.0.0
```

SQLite, SQL Server and Oracle enter subsequent releases unless they independently meet every v1 gate before the release freeze without delaying or destabilising the three-package baseline.

## Work-in-progress policy

Until v1.0.0:

- one active implementation PR at a time;
- every PR must advance a named gate in this document;
- no speculative dialect expansion;
- no new feature work on the legacy mysqljs-derived package except a critical security fix needed during migration;
- merge only after the relevant full regression matrix is green;
- delete the task branch after merge;
- keep `main` releasable and documented after every merge.

## Repository cleanup policy

Old branches and superseded PRs are not development queues. Close superseded PRs and remove stale branches after confirming their useful work is already merged or intentionally deferred.

The authoritative state is always `main` plus at most one active v1 task branch.

## Release decision

NuBloxSQL v1.0.0 is not declared stable until all five gates above are complete. Version numbers, marketing language or licence text do not override failed technical or provenance gates.
