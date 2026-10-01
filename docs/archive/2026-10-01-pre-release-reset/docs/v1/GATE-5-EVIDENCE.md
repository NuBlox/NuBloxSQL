# Gate 5 Evidence — Proprietary Stable v1 Release

Gate 5 qualifies the NuBloxSQL `1.0.0` release boundary.

## Stable package set

The release candidate validated by Gate 5 contains:

- `@nublox/mysql@1.0.0`
- `@nublox/postgresql@1.0.0`
- `@nublox/sql-core@1.0.0`

The private workspace root is also versioned `1.0.0` for release coordination.

## Proprietary IP boundary

The v1 release line is distributed under the NuBloxSQL Proprietary Software Licence, copyright 2026 Stephen J T Spittal. All rights reserved.

The release boundary explicitly records that historical copies previously distributed under earlier licence terms retain rights validly granted for those historical copies; Gate 5 does not claim retroactive revocation of earlier grants.

The proprietary audit passed with:

- no declared third-party npm runtime dependencies;
- no declared third-party npm development dependencies;
- no optional or peer third-party package dependencies;
- no dependency lockfile in the release boundary;
- no transitional clean-room package tree;
- no known mysqljs/mastered-package lineage markers in current v1 packages;
- no current Apache licence marker in v1 package licence/notice files;
- a proprietary `LICENSE` present for the repository and all three stable packages.

## Stable release audit

`npm run v1:release-audit` passed on Node.js 22, 24 and 26. It verifies:

- exact stable package names and `1.0.0` versions;
- `SEE LICENSE IN LICENSE` package metadata;
- proprietary licence marker in each package;
- `LICENSE` included in every publishable package's `files` surface;
- zero package dependencies;
- SQL Core contract family `1.0`;
- required migration, support, release and Gate evidence documents;
- absence of npm/yarn/pnpm dependency lockfiles.

## Package artefact evidence

The CI release matrix completed `npm pack --dry-run` successfully for:

- `@nublox/mysql@1.0.0`
- `@nublox/sql-core@1.0.0`
- `@nublox/postgresql@1.0.0`

This validates the intended stable publish surfaces without publishing to npm.

## Runtime and database matrix

### Node.js

The full v1 package verification, proprietary audit, stable-release audit and package dry-runs passed on:

- Node.js 22
- Node.js 24
- Node.js 26

### MySQL

The canonical MySQL v1 driver passed live validation against:

- MySQL 8.4
- MySQL 9.7

Live evidence includes direct streaming/backpressure, pooled streaming reuse, result-limit safety, deadline/cancellation safety, connection/authentication, prepared execution, transactions and pooling.

### PostgreSQL

The canonical PostgreSQL v1 driver passed live validation against:

- PostgreSQL 15
- PostgreSQL 16
- PostgreSQL 17
- PostgreSQL 18

Evidence includes native runtime and extended protocol, cancellation, pooling, portals, authentication/TLS failure paths, result-limit safety, deterministic type policy and the configured production performance/memory evidence.

## Security and robustness evidence

Gate 5 passed:

- NuBlox proprietary boundary audit;
- canonical MySQL protocol framing fuzz gate (10,000 iterations in CI);
- CodeQL JavaScript/TypeScript analysis;
- adapter result/resource-limit regression suites;
- supported live database matrices.

## Release documentation

The stable release includes:

- `V1-RELEASE-NOTES.md`
- `V1-MIGRATION.md`
- `V1-SUPPORT-MATRIX.md`
- `SQL-CORE-V1-CONTRACT.md`
- Gate 1, Gate 3, Gate 4 and Gate 5 evidence records.

## Gate decision

The stable v1 technical/provenance release criteria are satisfied on the Gate 5 branch. The branch may be merged only after its final documentation-inclusive CI rerun remains green.

Publishing packages to npm is a separate distribution action requiring the package owner's npm credentials and is not performed by this repository gate.
