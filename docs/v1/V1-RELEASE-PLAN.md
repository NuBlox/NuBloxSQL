# NuBloxSQL v1.0.0 Release Plan

This document is the single authoritative development path from the current repository state to NuBloxSQL v1.0.0.

## Release objective

NuBloxSQL v1.0.0 is a stable, production-grade, independently releasable SQL driver platform whose shipped implementation is NuBlox-authored proprietary intellectual property.

The v1 release boundary uses Node.js built-ins and NuBlox-authored source only. No copied or forked third-party implementation source and no third-party npm runtime/build/test dependency may be required to produce or validate the v1 release artifacts.

External database servers, published protocol specifications, operating systems, Node.js and hosting/CI infrastructure are interoperability targets or infrastructure; they are not bundled NuBloxSQL implementation dependencies.

## Current authoritative state

### SQL Core

`@nublox/sql-core` is the shared cross-dialect contract layer. Gate 4 is now active and will freeze only concepts that MySQL and PostgreSQL have both proved in production-oriented implementations.

### MySQL

Gates 1 and 2 are complete. `packages/mysql` is now the canonical NuBlox-authored, zero-package-dependency `@nublox/mysql` implementation. The historical mysqljs-derived package and the transitional `packages/mysql-cleanroom` tree no longer exist in the current v1 source tree.

The canonical package is currently `@nublox/mysql@1.0.0-rc.1`. Stable `1.0.0` and final proprietary licence text remain Gate 5 decisions.

Gate 2 evidence includes:

- legacy MySQL implementation removed from the current package tree;
- runtime and development package dependencies removed from the v1 validation boundary;
- canonical MySQL live validation on MySQL 8.4 and 9.7;
- Node 22/24/26 package-contract validation;
- proprietary source/dependency audit passing with zero blockers;
- native protocol fuzzing and CodeQL green;
- MySQL, SQL Core and PostgreSQL package dry-runs green.

### PostgreSQL

Gate 3 is complete. `@nublox/postgresql` is a NuBlox-authored native driver with no npm package dependencies and a v1 production baseline across PostgreSQL 15, 16, 17 and 18.

The Gate 3 evidence record is `docs/v1/GATE-3-EVIDENCE.md`.

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
- timeout, deadline and AbortSignal semantics
- deterministic resource cleanup
- TypeScript declaration surface without requiring TypeScript as a release dependency
- error model and SQLSTATE/native-code preservation
- streaming/backpressure where required for production workloads
- session reset/state behaviour required by pooling
- observability implemented with Node/NuBlox primitives only
- live MySQL version matrix

Features from the historical driver that are not required for v1 stability are deferred rather than retaining legacy source.

### Gate 2 — Replace legacy `@nublox/mysql` — COMPLETE

Gate 2 completed the clean-room cut-over:

1. `packages/mysql-cleanroom` was promoted to canonical `packages/mysql` / `@nublox/mysql`;
2. the mysqljs-derived implementation was removed from the current v1 source tree;
3. inherited package lineage/provenance files no longer exist in the canonical package;
4. historical runtime dependencies including `bignumber.js`, `named-placeholders`, `safe-buffer` and `sqlstring` were eliminated;
5. mysql2, legacy test runners, ESLint/TypeScript-driven release gates and their package dependency graph were removed from the v1 validation boundary;
6. repository verification now runs using Node.js, NuBlox packages and CI infrastructure without installing third-party npm implementation/test tooling;
7. `npm run v1:proprietary-audit` passed with zero blockers at the Gate 2 merge boundary.

Historical Git history remains historical evidence and is not rewritten or represented as original NuBlox authorship.

### Gate 3 — PostgreSQL v1 hardening — COMPLETE

Gate 3 is complete. See `docs/v1/GATE-3-EVIDENCE.md` for the implementation, supported-version and production-soak evidence.

The completed PostgreSQL v1 surface includes:

- native simple and extended query protocols;
- prepared statements and typed parameters;
- PostgreSQL CancelRequest cancellation with recovery semantics;
- bounded pooling, transactions and savepoints;
- native server-side portals/cursors with bounded batches;
- bounded result rows, result bytes and row bytes with fail-closed connection handling;
- deterministic lossless type/precision semantics;
- TLS/authentication negative-path hardening;
- live PostgreSQL 15/16/17/18 matrix;
- production performance, pool-contention, portal, cancellation and forced-GC memory-soak evidence;
- zero third-party PostgreSQL driver/protocol/type dependencies.

PostgreSQL-specific semantics remain first class rather than being forced into a MySQL-shaped API.

### Gate 4 — Stabilise SQL Core — ACTIVE

Now that MySQL and PostgreSQL both implement production-oriented adapters, Gate 4 freezes only portable concepts proven by both:

- freeze v1 execution/result contracts;
- freeze transaction/cancellation semantics;
- freeze error categorisation rules;
- freeze metadata/type extension points;
- reconcile deadline, resource-limit and observability vocabulary where genuinely portable;
- keep vendor-only capabilities in adapters;
- reject lowest-common-denominator abstractions;
- publish a v1 compatibility contract for adapter implementers and consumers.

SQL Core must not grow by theoretical abstraction. Every frozen contract requires evidence from both canonical adapters or a clear cross-dialect policy role.

### Gate 5 — Proprietary and release audit

`npm run v1:proprietary-audit` is mandatory and must pass with zero findings at the final release commit.

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
- merge only after the relevant full regression matrix is green;
- delete the task branch after merge;
- keep `main` releasable and documented after every merge.

## Repository cleanup policy

Old branches and superseded PRs are not development queues. Close superseded PRs and remove stale branches after confirming their useful work is already merged or intentionally deferred.

The authoritative state is always `main` plus at most one active v1 task branch.

## Release decision

NuBloxSQL v1.0.0 is not declared stable until all five gates above are complete. Version numbers, marketing language or licence text do not override failed technical or provenance gates.
