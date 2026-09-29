# NuBloxSQL

NuBloxSQL is an independent, proprietary, multi-dialect SQL driver platform for Node.js.

## Package status

| Package | Version | Status | Role |
| --- | ---: | --- | --- |
| `@nublox/sql-core` | `1.0.0` | Stable | Portable contracts and dialect vocabulary |
| `@nublox/mysql` | `1.0.0` | Stable | Native MySQL adapter |
| `@nublox/postgresql` | `1.0.0` | Stable | Native PostgreSQL adapter |
| `@nublox/sqlite` | `0.1.0` | Development | Embedded SQLite adapter using `node:sqlite` |
| `@nublox/sqlserver` | — | Planned | SQL Server adapter |
| `@nublox/oracle` | — | Planned | Oracle adapter |

The stable v1.0.0 release boundary is the three-package set `@nublox/sql-core`, `@nublox/mysql` and `@nublox/postgresql`. SQLite is post-v1 development and is not part of the v1.0.0 support claim.

## Architecture

NuBloxSQL separates portable contracts from database-specific implementation:

```text
                    @nublox/sql-core
                           │
          ┌────────────────┼────────────────┐
          │                │                │
          ▼                ▼                ▼
  @nublox/mysql   @nublox/postgresql   @nublox/sqlite
          │                │                │
       MySQL           PostgreSQL         SQLite
      protocol          protocol       embedded API
```

Shared contracts are promoted only when semantics are genuinely portable. Authentication, protocol framing, locking, storage, type-system details and other vendor behaviour remain adapter-owned.

See [docs/architecture/multi-dialect.md](docs/architecture/multi-dialect.md).

## Supported stable v1 matrix

- Node.js 22, 24 and 26
- MySQL 8.4 and 9.7
- PostgreSQL 15, 16, 17 and 18

SQLite development requires Node.js 22.16.0 or later.

See [docs/v1/V1-SUPPORT-MATRIX.md](docs/v1/V1-SUPPORT-MATRIX.md).

## Verification

```bash
npm run verify
npm run v1:proprietary-audit
npm run v1:release-audit
```

`npm run verify` exercises the current workspace, including SQLite development. The v1 release audit remains pinned to the three stable v1.0.0 packages.

CI additionally validates supported Node/database matrices, package dry-runs, protocol and resource-safety behaviour, proprietary boundaries, fuzzing and CodeQL.

## Local workspace setup

NuBloxSQL intentionally keeps the proprietary release boundary lockfile-free. The repository `.npmrc` disables `package-lock.json` generation.

```bash
rm -f package-lock.json
npm install
npm run verify
```

## Documentation

Start with [docs/README.md](docs/README.md).

Key documents:

- [Architecture](docs/architecture/multi-dialect.md)
- [Roadmap](NUBLOX-SQL-ROADMAP.md)
- [v1 support matrix](docs/v1/V1-SUPPORT-MATRIX.md)
- [v1 release notes](docs/v1/V1-RELEASE-NOTES.md)
- [v1 migration guide](docs/v1/V1-MIGRATION.md)
- [SQL Core v1 contract](docs/v1/SQL-CORE-V1-CONTRACT.md)
- [Proprietary release gate](docs/v1/PROPRIETARY-IP-RELEASE-GATE.md)

## Licence

NuBloxSQL is proprietary software. Copyright (c) 2026 Stephen J T Spittal. All rights reserved. See [LICENSE](LICENSE).

Public availability of the repository does not grant an open-source licence. Historical copies validly distributed under earlier licence terms retain the rights granted for those copies.

## Independence

NuBloxSQL is independently usable, testable, versionable and releasable. Other NuBlox products may consume it, but they are not part of its architecture or release criteria.
