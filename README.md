# NuBloxSQL

NuBloxSQL is an independent multi-dialect SQL driver platform for Node.js.

## Stable v1 baseline

NuBloxSQL v1.0.0 contains three stable packages:

- `@nublox/mysql@1.0.0` — NuBlox-authored native MySQL driver.
- `@nublox/postgresql@1.0.0` — NuBlox-authored native PostgreSQL driver.
- `@nublox/sql-core@1.0.0` — stable cross-dialect contract family `1.0`.

The v1 implementation boundary uses Node.js built-ins and NuBlox-authored source. The stable packages declare no third-party npm runtime, development, optional or peer dependencies.

## Post-v1 development

The next dialect wave has started with:

- `@nublox/sqlite@0.1.0` — embedded SQLite foundation using Node.js `node:sqlite` with no third-party npm dependency.

The SQLite foundation provides prepared execution, explicit transaction modes, savepoints, result limits, deterministic error classification, database/table/column introspection and typed APIs. SQL Server and Oracle remain planned later dialects.

## Architecture

NuBloxSQL keeps portable contracts, dialect syntax/services and vendor runtimes separate. Database-specific behaviour remains inside each adapter rather than being forced into a lowest-common-denominator API.

```text
                @nublox/sql-core
                      ▲
          ┌───────────┼───────────┐
          │           │           │
 @nublox/mysql @nublox/postgresql @nublox/sqlite
```

See `docs/architecture/multi-dialect.md` and `docs/v1/SQL-CORE-V1-CONTRACT.md`.

## Repository layout

```text
packages/
  sql-core/
  mysql/
  postgresql/
  sqlite/
```

The repository root orchestrates the workspace and release gates; applications consume the individual packages.

## Supported matrix

Stable v1 qualification:

- Node.js 22, 24 and 26
- MySQL 8.4 and 9.7
- PostgreSQL 15, 16, 17 and 18

SQLite development currently requires Node.js 22.16.0 or later because the adapter uses Node's built-in SQLite metadata and transaction-state APIs.

See `docs/v1/V1-SUPPORT-MATRIX.md` for the qualified v1 release matrix.

## Verification

```bash
npm run verify
npm run v1:proprietary-audit
npm run v1:release-audit
```

`npm run verify` exercises MySQL, PostgreSQL, SQL Core and the current SQLite development package. The stable v1 release audit remains pinned to the three v1.0.0 packages.

CI additionally validates package dry-runs, supported database integration matrices, protocol/resource failure paths, fuzzing and CodeQL.

## Local workspace setup

NuBloxSQL's proprietary release boundary intentionally contains no dependency lockfile. The repository `.npmrc` disables `package-lock.json` generation so a normal `npm install` does not invalidate the local proprietary/release audits.

If a lockfile was created by an older checkout, remove it once before running the release gates:

```bash
rm -f package-lock.json
npm install
npm run verify:proprietary
```

## Migration and release documentation

- `docs/v1/V1-MIGRATION.md`
- `docs/v1/V1-RELEASE-NOTES.md`
- `docs/v1/V1-SUPPORT-MATRIX.md`
- `docs/v1/V1-RELEASE-PLAN.md`
- `docs/v1/PROPRIETARY-IP-RELEASE-GATE.md`

## Licence

NuBloxSQL is proprietary software. Copyright (c) 2026 Stephen J T Spittal. All rights reserved. See `LICENSE`.

Public availability of this repository does not grant an open-source licence. Historical copies previously distributed under earlier licence terms retain the rights validly granted for those copies.

## Independence

NuBloxSQL is independently usable, testable, versionable and releasable. Its architecture and roadmap do not depend on any other NuBlox project.
