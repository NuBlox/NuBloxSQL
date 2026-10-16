# NuBloxSQL

**Status: proprietary, ground-up native-driver implementation underway. The first private PostgreSQL protocol v3 Driver and independent Shell are undergoing live CI qualification. Workbench, remote TLS and a complete TASK-001 release are not yet implemented. Nothing in this repository is published from the reboot.**

**Mission: NuBloxSQL aims to become the database technology platform of choice.**

NuBloxSQL is a **proprietary, independently engineered universal database technology platform**, not just a driver accompanied by two tools. It aims to cover first-party native drivers, ORM and model-native mapping, type-safe query builders, parsing/compilation, schema/migration tools, database design and development, security, administration, data operations and complete professional lifecycle workflows. A further ambition is genuine cross-vendor interoperability: for example, giving MySQL-oriented users a familiar way to access supported PostgreSQL capabilities without pretending the engines are equivalent.

**NuBloxSQL Driver** is the native programmable foundation; **NuBloxSQL Shell** and **NuBloxSQL Workbench** are terminal and graphical professional applications. **ORM, query builder and other developer-facing technologies are independent capabilities within the wider NuBloxSQL platform**, not automatically part of the Driver or subordinate to the applications.

The ambition to become the tool of choice must be **earned and verified** through demonstrable depth, reliability, performance, security and user productivity. The authoritative scope is [the product definition](docs/PRODUCT.md).

**Universal describes the intended destination, not current vendor coverage.** The target includes relational SQL and non-SQL databases, local and managed cloud deployments, with each native protocol, database model, authentication method and vendor feature independently qualified.

This is a deliberately clean restart. The previous implementation is preserved on [archive/legacy-implementation-2026-10-16](https://github.com/NuBlox/NuBloxSQL/tree/archive/legacy-implementation-2026-10-16), at commit `4ed0e35fbfe71ac110c9ec41cf62ba3355e9d56c`. Existing v1 npm releases are historical artefacts; **this branch must not be treated as their source or published over them**.

## Read this, in order

1. [Product definition](docs/PRODUCT.md) — **mission, strategic capability families, audience and non-goals**.
2. [Users and lifecycle](docs/USERS-AND-LIFECYCLE.md) — the work NuBloxSQL must make possible.
3. [Database careers and job roles](docs/CAREERS.md) — 18 families, 240 role entries and vendor specialisations.
4. [TASK-001: inspect a database](docs/TASK-001.md) — proposed first complete Driver/Shell/Workbench workflow and work-product schema.
5. [Requirements](docs/REQUIREMENTS.md) — what must be demonstrated and accepted.
6. [Architecture](docs/ARCHITECTURE.md) — native infrastructure, composable technologies and application boundaries.
7. [Support and qualification](docs/SUPPORT-AND-QUALIFICATION.md) — truthful vendor and cloud support.
8. [Roadmap](docs/ROADMAP.md) — gated delivery order.
9. [Decision log](docs/DECISIONS.md) — agreed decisions versus open questions.
10. [Archive evidence and reuse assessment](docs/ARCHIVE.md) — audited first-party implementations and engineering modules worth qualifying before writing duplicates.

[Profession work register](docs/WORK-REGISTER.md) maps 64 unreviewed professional activities, expected work products and lifecycle phases to future Shell and Workbench workflows. [The career taxonomy](docs/data/database-careers.json) captures the complete supplied job-title and technology-specialisation list, while archived activity mappings remain provisional and are not blindly inherited.

## GitHub repository protection

The [administrator ruleset procedure](docs/admin/README.md) defines the required PR/CI protection for `main` and immutability of the archived implementation. **Both branches are now protected** (active rulesets #25231727 and #25231728); the owner may run the final read-only verifier. Now that runtime CI exists, the owner must also require the always-on Node check; [the guarded upgrade instructions](docs/admin/README.md) and [issue #328](https://github.com/NuBlox/NuBloxSQL/issues/328) track this last administrator action.

## Reuse existing NuBloxSQL engineering before rewriting

The [immutable archived implementation assessment](docs/ARCHIVE.md) identifies substantial first-party PostgreSQL, MySQL, SQL Server and Redis protocol code and schema/migration/query compiler assets. **These are candidates for comparison and qualification, not current release support.** The archived MongoDB adapter wraps the third-party `mongodb` client and therefore does not satisfy our first-party native protocol rule.

Development must investigate the relevant archived source and tests before implementing replacements. An isolated [archive reference CI job](.github/workflows/archive-assessment.yml) runs selected historic unit suites without modifying the archive.

## First executable slice — not a released product

The `@nubloxsql/driver` private TypeScript package implements **read-only PostgreSQL 17 inventory using NuBloxSQL-owned wire framing, SCRAM authentication and native query flow**, not a third-party PostgreSQL driver. It returns scoped catalog metadata, safe error codes, explicit transport policy, finite limits and redacted output. The independent `@nubloxsql/shell` package calls its **public API** to write a protected JSON work product. Both are experimental; Workbench is not yet implemented.

The initial native wire client supports explicitly isolated PostgreSQL loopback only, with SCRAM-SHA-256 using currently ASCII-only password input. Remote TLS/cloud, channel binding and other authentication schemes have **not** passed qualification and must be refused rather than silently delegated to another driver. Source API and work-product details are defined in [TASK-001](docs/TASK-001.md).

On Node.js 24, run `npm ci`, `npm run build` and `npm run test:unit`. Live tests run against a digest-pinned PostgreSQL 17 CI service. The Shell requires an explicit `NUBLOXSQL_PG_SECURITY` value (`isolated-local` or `verified-tls`) and an environment-based secret; it does not accept a password on the command line. **Do not publish** the private package or claim production support.

## Ground rules

- **Mission before implementation.** Every Driver, ORM, query builder, Shell, Workbench or other feature must trace to a professional or developer outcome, accepted interfaces and qualification evidence.
- **One source of truth for each topic.** Update the appropriate document; do not create a competing blueprint, wave, phase, registry or roadmap.
- **No fake compatibility or superiority.** SQL and non-SQL native semantics remain distinct, interoperability needs evidence, a catalogue entry is not an adapter, and comparative superiority needs reproducible benchmarking.
- **Preserve history.** Never delete or rewrite the archive; recover useful prior code selectively, after a requirement and interface contract justify it.
- **Incremental qualification:** private TypeScript packages may now be introduced only for approved TASK-001 outcomes; live tests and work-product evidence are mandatory before support claims. Avoid unrelated feature expansion.

Copyright (c) 2026 Stephen J T Spittal. All rights reserved. See [LICENSE](LICENSE).
