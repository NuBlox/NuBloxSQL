# NuBloxSQL

NuBloxSQL is an independent multi-dialect SQL driver platform for Node.js.

## Package family

- `@nublox/sql-core` — vendor-neutral SQL contracts and dialect primitives.
- `@nublox/mysql` — MySQL protocol driver.
- `@nublox/postgresql` — PostgreSQL dialect foundation; protocol runtime under development.

Planned dialect families include SQLite, SQL Server and Oracle.

## Architecture

NuBloxSQL keeps portable contracts, dialect syntax/services and vendor protocol runtimes separate. Database-specific behaviour remains inside each adapter rather than being forced into a lowest-common-denominator API.

See `NUBLOX-SQL-ROADMAP.md` and `docs/architecture/multi-dialect.md`.

## Repository layout

```text
packages/
  sql-core/
  mysql/
  postgresql/
```

Each adapter is independently versioned and publishable. The repository root is private workspace orchestration and is not an npm runtime package.

## Development

```bash
npm install
npm run verify
```

Individual packages can also be validated through npm workspaces.

## Independence

NuBloxSQL is independently usable, testable, versionable and releasable. Its architecture and roadmap do not depend on any other NuBlox project.
