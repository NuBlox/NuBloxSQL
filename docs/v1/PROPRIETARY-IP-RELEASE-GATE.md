# NuBloxSQL v1.0.0 Proprietary IP Release Gate

NuBloxSQL v1.0.0 is not releasable until every condition in this document is satisfied.

## Ownership target

NuBloxSQL v1.0.0 is a NuBlox-authored SQL driver platform. Production source code must be original NuBlox implementation and must not be copied, forked, adapted, translated, vendored, bundled, or derived from a third-party driver or library.

Published database protocol and vendor specifications may be used as behavioural and interoperability references. Existing third-party driver source code must not be used as implementation source for clean-room replacement work.

## Zero-third-party dependency rule

Release packages may depend only on:

- Node.js built-in modules and Web Platform APIs supplied by the supported Node.js runtime.
- Other proprietary NuBloxSQL workspace packages authored under this policy.
- Database servers and operating-system services accessed through documented protocols at runtime.

The following are prohibited in the v1 release boundary:

- third-party npm runtime dependencies;
- third-party optional or peer dependencies;
- third-party development libraries required to build, test, lint, package, or release v1;
- vendored third-party source;
- copied/forked source lineage;
- generated code whose licence imposes third-party redistribution obligations;
- package files that require THIRD_PARTY_NOTICES for shipped implementation code.

## Clean-room MySQL requirement

The current `@nublox/mysql` implementation records lineage from `mysqljs/mysql`. It is therefore a migration/reference implementation only and cannot form part of the proprietary v1 release.

Before v1, MySQL must be replaced with a NuBlox-authored implementation built from MySQL protocol/vendor specifications and black-box compatibility tests. Behavioural compatibility may be retained; inherited source may not.

The replacement must cover the v1 support surface before the legacy implementation is removed:

1. connection and packet framing;
2. TLS and authentication;
3. text query protocol;
4. prepared statements and binary protocol;
5. result/type decoding;
6. transactions and session state;
7. pooling and lifecycle management;
8. cancellation/timeouts;
9. compression where retained as a supported feature;
10. binlog/CDC where retained as a supported feature;
11. TypeScript/public API compatibility selected for v1.

## PostgreSQL requirement

`@nublox/postgresql` must remain dependency-free and NuBlox-authored. All future extended-query, pooling, COPY, notification, replication, type, and performance work must follow the same rule.

## SQL Core requirement

`@nublox/sql-core` must remain dependency-free and contain only NuBlox-authored cross-dialect contracts and policy.

## Additional dialects

SQLite, SQL Server, Oracle, and any future adapters are not accepted into v1 unless they meet the same ownership and dependency rules. A dialect may be excluded from v1 rather than shipped below this standard.

## Release evidence

A v1 release candidate must provide all of the following evidence:

- `node tool/check-proprietary-v1.js` passes;
- every publishable package has zero non-NuBlox package dependencies;
- no `NUBLOX-UPSTREAM.json`, `THIRD_PARTY_NOTICES`, upstream/fork/mastered-package metadata, or known inherited implementation remains in the release tree;
- provenance documentation identifies each shipped implementation package as NuBlox-original;
- clean package tarball inspection passes for every workspace package;
- unit, protocol, fuzz, integration, interoperability, security, soak, and performance gates pass;
- live supported database-version matrices pass;
- all public API and TypeScript contract tests pass;
- v1 licence text is applied only after the codebase actually satisfies this ownership gate.

## Licence transition rule

Changing licence text does not make inherited source proprietary. NuBloxSQL will not replace current third-party-compatible notices or licences for inherited code until that code has been removed from the release boundary.

The proprietary v1 licence is the final legal packaging step after clean-room implementation and provenance verification, not the first step.
