# NuBloxSQL

**NuBloxSQL is the NuBlox-owned SQL connectivity and database-runtime platform.**

Its purpose is to give NuBlox applications and other Node.js consumers one deliberate database substrate across multiple SQL engines without pretending those engines are identical.

NuBloxSQL is therefore **not** just a collection of unrelated drivers and it is **not** a lowest-common-denominator ORM. It is one platform made from a stable portable contract layer plus first-class native dialect runtimes.

## Design intent

NuBloxSQL is intended to sit underneath database-consuming products such as NuBlox SQL Workbench and, where appropriate, the wider NuBlox application estate.

```text
        NuBlox applications / SQL Workbench / other consumers
                              │
                              ▼
                    NuBloxSQL platform contract
                    @nublox/sql-core
                              │
         ┌────────────────────┼────────────────────┐
         ▼                    ▼                    ▼
 @nublox/mysql       @nublox/postgresql       @nublox/sqlite
         │                    │                    │
         ▼                    ▼                    ▼
       MySQL              PostgreSQL              SQLite
     native runtime        native runtime       embedded runtime
```

The platform has four architectural responsibilities:

1. **Portable contracts** — shared execution, result, transaction, error, resource-limit, metadata and capability vocabulary.
2. **Dialect services** — quoting, placeholders, capability discovery and database-family SQL semantics.
3. **Native adapter runtimes** — protocol/authentication/storage lifecycle, prepared execution, cancellation, pooling, locking, type fidelity and vendor-specific behaviour.
4. **Consumer integration** — a stable database substrate for tooling and applications so consumers do not need to own database transport logic.

The governing rule is: **unify what is genuinely portable; preserve what is genuinely database-specific.**

See [Design intent](docs/architecture/design-intent.md) and [Multi-dialect architecture](docs/architecture/multi-dialect.md).

## Package family

| Package | Version | Status | Responsibility |
| --- | ---: | --- | --- |
| `@nublox/sql-core` | `1.0.0` | Stable | Platform contracts and portable SQL/runtime vocabulary |
| `@nublox/mysql` | `1.0.0` | Stable | Native MySQL runtime |
| `@nublox/postgresql` | `1.0.0` | Stable | Native PostgreSQL runtime |
| `@nublox/sqlite` | `0.1.0` | Development | Embedded SQLite runtime |
| `@nublox/sqlserver` | — | Planned | SQL Server runtime |
| `@nublox/oracle` | — | Planned | Oracle runtime |

The packages are independently versioned because database engines evolve independently. They still form one NuBloxSQL platform and must conform to the same architectural rules, quality gates and platform contracts where those contracts apply.

## Stable v1 baseline

NuBloxSQL v1.0.0 established the first stable platform baseline with:

- `@nublox/sql-core@1.0.0`;
- `@nublox/mysql@1.0.0`;
- `@nublox/postgresql@1.0.0`.

Qualified runtime matrix:

- Node.js 22, 24 and 26;
- MySQL 8.4 and 9.7;
- PostgreSQL 15, 16, 17 and 18.

SQLite `0.1.0` is active post-v1 development and is intentionally outside the v1.0.0 support claim.

See [v1 support matrix](docs/v1/V1-SUPPORT-MATRIX.md).

## Platform principles

Every NuBloxSQL adapter must follow these rules:

- own its real database protocol/runtime semantics;
- expose explicit capability metadata rather than relying on package-name assumptions;
- preserve database-native concepts such as schemas, catalogs, transaction states, type identities and locking semantics;
- avoid silent semantic emulation;
- expose native extensions when the portable contract is insufficient;
- preserve data fidelity rather than applying convenient lossy conversions;
- provide deterministic error and resource-limit behaviour;
- remain independently testable and releasable;
- meet supported-version CI, security and proprietary-source gates before a stable support claim is made.

## What NuBloxSQL should enable

A consumer should be able to build against NuBloxSQL for common concerns — connection lifecycle, execution, transactions, results, metadata, errors, limits and capability discovery — while still being able to access engine-specific power when it matters.

For example, NuBlox SQL Workbench should consume NuBloxSQL adapters for connectivity and database semantics while the Workbench itself owns editor UX, object-explorer presentation, administration workflows and schema-design tooling.

```text
SQL Workbench UI
      │
      ▼
Workbench provider/services
      │
      ▼
NuBloxSQL
      │
      ▼
Database engine
```

That boundary is fundamental: **database runtime logic belongs in NuBloxSQL, not duplicated in every consuming application.**

## Current development direction

The immediate active programme is SQLite hardening. The next engineering slice is deeper schema introspection, followed by database lifecycle, attached-database management, type-affinity/STRICT semantics, storage/locking policy, observability and release qualification.

After SQLite reaches the required maturity, the planned dialect sequence continues with SQL Server and Oracle.

See [NuBloxSQL roadmap](NUBLOX-SQL-ROADMAP.md).

## Verification

```bash
npm run verify
npm run v1:proprietary-audit
npm run v1:release-audit
```

`npm run verify` validates the current workspace. Stable-release audits remain intentionally pinned to the v1.0.0 package baseline.

## Documentation

Start with [docs/README.md](docs/README.md).

The key current documents are:

- [Design intent](docs/architecture/design-intent.md)
- [Multi-dialect architecture](docs/architecture/multi-dialect.md)
- [Roadmap](NUBLOX-SQL-ROADMAP.md)
- [Documentation standard](docs/STYLE.md)
- [Stable v1 support matrix](docs/v1/V1-SUPPORT-MATRIX.md)
- [SQL Core v1 contract](docs/v1/SQL-CORE-V1-CONTRACT.md)

## Licence

NuBloxSQL is proprietary software. Copyright (c) 2026 Stephen J T Spittal. All rights reserved. See [LICENSE](LICENSE).

Public availability of this repository does not grant an open-source licence. Historical copies validly distributed under earlier licence terms retain the rights granted for those copies.
