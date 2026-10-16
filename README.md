# NuBloxSQL

**Status: G1 implementation underway — the first private PostgreSQL Driver and independent Shell code is present for CI qualification. Workbench and a complete TASK-001 release are not yet implemented. Nothing in this repository is published from the reboot.**

NuBloxSQL is a proposed **universal database connectivity and professional database-work platform**. It consists of three distinct products:

1. **NuBloxSQL Driver** — a headless, programmable JavaScript/TypeScript API with qualified native database adapters, capability discovery and reusable database operations.
2. **NuBloxSQL Shell** — a terminal application for interactive and automated database work through the public Driver API.
3. **NuBloxSQL Workbench** — a graphical application for guided database work through the same public Driver API.

**Universal does not mean that every vendor is supported today.** The target includes relational SQL and non-SQL databases, local and managed cloud deployments, with each native protocol, database model, authentication method and vendor feature independently qualified.

This is a deliberately clean restart. The previous implementation is preserved on [archive/legacy-implementation-2026-10-16](https://github.com/NuBlox/NuBloxSQL/tree/archive/legacy-implementation-2026-10-16), at commit `4ed0e35fbfe71ac110c9ec41cf62ba3355e9d56c`. Existing v1 npm releases are historical artefacts; **this branch must not be treated as their source or published over them**.

## Read this, in order

1. [Product definition](docs/PRODUCT.md) — **what, why, who, where, when and how**.
2. [Users and lifecycle](docs/USERS-AND-LIFECYCLE.md) — the work NuBloxSQL must make possible.
3. [Database careers and job roles](docs/CAREERS.md) — 18 families, 240 role entries and vendor specialisations.
4. [TASK-001: inspect a database](docs/TASK-001.md) — proposed first complete Driver/Shell/Workbench workflow and work-product schema.
5. [Requirements](docs/REQUIREMENTS.md) — what must be demonstrated and accepted.
6. [Architecture](docs/ARCHITECTURE.md) — hard product/module boundaries.
7. [Support and qualification](docs/SUPPORT-AND-QUALIFICATION.md) — truthful vendor and cloud support.
8. [Roadmap](docs/ROADMAP.md) — gated delivery order.
9. [Decision log](docs/DECISIONS.md) — agreed decisions versus open questions.
10. [Archive and recovery](docs/ARCHIVE.md) — how to inspect or restore previous work.

[Profession work register](docs/WORK-REGISTER.md) maps 64 unreviewed professional activities, expected work products and lifecycle phases to future Shell and Workbench workflows. [The career taxonomy](docs/data/database-careers.json) captures the complete supplied job-title and technology-specialisation list, while archived activity mappings remain provisional and are not blindly inherited.

## GitHub repository protection

The [administrator ruleset procedure](docs/admin/README.md) defines the required PR/CI protection for `main` and immutability of the archived implementation. **Both branches are now protected** (active rulesets #25231727 and #25231728); the owner may run the final read-only verifier. Now that runtime CI exists, the owner must also require the always-on Node check; [the guarded upgrade instructions](docs/admin/README.md) and [issue #328](https://github.com/NuBlox/NuBloxSQL/issues/328) track this last administrator action.

## First executable slice — not a released product

The `@nubloxsql/driver` private TypeScript package now implements **read-only PostgreSQL 17 inventory** with a scoped catalog query, safe error codes, explicit transport policy, finite limits and redacted output. The independent `@nubloxsql/shell` package calls its **public API** to write a protected JSON work product. Both are experimental; Workbench is not yet implemented.

The initial local fixture contract requires a PostgreSQL instance on `127.0.0.1`, explicit environment-sourced credentials and `security=isolated-local`; remote TLS/cloud deployments have **not** passed qualification. Source API and work-product details are defined in [TASK-001](docs/TASK-001.md).

On Node.js 24, run `npm ci`, `npm run build` and `npm run test:unit`. Live tests run against a digest-pinned PostgreSQL 17 CI service. The Shell requires an explicit `NUBLOXSQL_PG_SECURITY` value (`isolated-local` or `verified-tls`) and an environment-based secret; it does not accept a password on the command line. **Do not publish** the private package or claim production support.

## Ground rules

- **Specification before implementation.** No new driver, CLI, Workbench, vendor integration or package until requirements and its qualification criteria are approved.
- **One source of truth for each topic.** Update the appropriate document; do not create a competing blueprint, wave, phase, registry or roadmap.
- **No fake compatibility.** SQL and non-SQL native semantics remain distinct. Catalogue entries are not implemented adapters. Cloud hosting is not equivalent to proven cloud authentication.
- **Preserve history.** Never delete or rewrite the archive; recover useful prior code selectively, after a requirement and interface contract justify it.
- **Incremental qualification:** private TypeScript packages may now be introduced only for approved TASK-001 outcomes; live tests and work-product evidence are mandatory before support claims. Avoid unrelated feature expansion.

Copyright (c) 2026 Stephen J T Spittal. All rights reserved. See [LICENSE](LICENSE).
