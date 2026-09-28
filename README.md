# NuBloxSQL

NuBloxSQL is an independent multi-dialect SQL driver platform for Node.js.

## Current v1 direction

NuBloxSQL is converging on a stable proprietary `v1.0.0` release built from NuBlox-authored implementation code and Node.js built-ins, with no third-party npm implementation/build/test dependency in the v1 release boundary.

The single authoritative release path is [`docs/v1/V1-RELEASE-PLAN.md`](docs/v1/V1-RELEASE-PLAN.md). The provenance/licensing gate is documented in [`docs/v1/PROPRIETARY-IP-RELEASE-GATE.md`](docs/v1/PROPRIETARY-IP-RELEASE-GATE.md).

Until v1 ships, development follows one critical path and one active implementation PR at a time.

## Package family

- `@nublox/sql-core` — vendor-neutral SQL contracts and dialect primitives.
- `packages/mysql-cleanroom` — NuBlox-authored zero-package-dependency MySQL replacement under active v1 development.
- `@nublox/mysql` — legacy mysqljs-derived package retained temporarily as a behavioural/compatibility baseline only; it is not eligible for proprietary v1 and will be replaced by the clean-room implementation.
- `@nublox/postgresql` — NuBlox-authored native PostgreSQL driver with no npm dependencies; currently at its pre-v1 release-candidate stage.

SQLite, SQL Server, Oracle and additional dialects are deferred until the MySQL replacement, PostgreSQL hardening, SQL Core stabilisation and proprietary release gates are complete.

## Architecture

NuBloxSQL keeps portable contracts, dialect syntax/services and vendor protocol runtimes separate. Database-specific behaviour remains inside each adapter rather than being forced into a lowest-common-denominator API.

See `docs/architecture/multi-dialect.md` for architecture and `docs/v1/V1-RELEASE-PLAN.md` for current delivery priority.

## Repository layout

```text
packages/
  sql-core/
  mysql/             # legacy migration baseline; not v1-eligible
  mysql-cleanroom/   # proprietary replacement
  postgresql/
```

The repository root is workspace orchestration and is not an npm runtime package.

## Development

```bash
npm install
npm run verify
```

The proprietary v1 audit is intentionally separate while migration remains incomplete:

```bash
npm run v1:proprietary-audit
```

That command must be a mandatory green release gate before `v1.0.0` is declared stable.

## Independence

NuBloxSQL is independently usable, testable, versionable and releasable. Its architecture and roadmap do not depend on any other NuBlox project.
