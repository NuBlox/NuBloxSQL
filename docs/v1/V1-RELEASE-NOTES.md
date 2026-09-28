# NuBloxSQL 1.0.0 Release Notes

NuBloxSQL 1.0.0 establishes the first stable proprietary NuBloxSQL driver platform baseline.

## Stable packages

- `@nublox/mysql@1.0.0`
- `@nublox/postgresql@1.0.0`
- `@nublox/sql-core@1.0.0`

All three v1 packages declare zero third-party npm runtime, development, optional and peer dependencies.

## MySQL v1

The canonical MySQL package is a NuBlox-authored native protocol implementation. The historical mysqljs-derived implementation is not present in the current v1 source/package tree.

Highlights include:

- native connection/TLS/authentication lifecycle;
- simple and prepared execution;
- typed parameters/results;
- transactions and savepoints;
- bounded pools with session-reset hygiene;
- streaming with socket-level backpressure;
- bounded row/result resources;
- timeout, absolute deadline and AbortSignal controls;
- deterministic cleanup and stable error taxonomy;
- live MySQL 8.4 and 9.7 qualification.

## PostgreSQL v1

The PostgreSQL package is a native frontend/backend protocol implementation with no dependency on `pg` or another PostgreSQL driver.

Highlights include:

- TCP/TLS and SCRAM authentication;
- simple and extended query protocols;
- prepared statements and parameterized execution;
- native CancelRequest cancellation;
- transactions/savepoints and bounded pooling;
- native portal cursors with bounded batches;
- lossless deterministic type policy;
- result/resource limits and failure-path hardening;
- live PostgreSQL 15, 16, 17 and 18 qualification;
- performance and forced-GC resource-soak evidence.

## SQL Core v1

SQL Core contract family `1.0` freezes only concepts proven by both canonical adapters. Vendor-specific semantics remain first class.

The contract includes dialect identity/capabilities, positional execution, relative timeout/cancellation policy, result limits, portable result/metadata vocabulary, transaction policy and portable error categorisation.

Generic named parameters, generic multi-results and universal absolute deadlines were intentionally excluded from the v1 freeze.

## Proprietary release boundary

NuBloxSQL v1 is distributed under the NuBloxSQL Proprietary Software Licence, copyright 2026 Stephen J T Spittal. All rights reserved.

The v1 release gate verifies:

- zero third-party package dependencies;
- absence of known inherited-source lineage markers in current v1 packages;
- proprietary licence files in every stable package;
- stable `1.0.0` manifests;
- clean package dry-runs;
- supported Node/server integration matrices;
- CodeQL and protocol/resource regression gates.

Historical copies previously distributed under earlier licence terms retain the rights validly granted for those copies.

## Supported platform

See `V1-SUPPORT-MATRIX.md` for the qualified Node.js and database-server versions, and `V1-MIGRATION.md` for upgrade guidance.
