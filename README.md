# NuBloxSQL

**Status: documentation-first reboot — no runnable application or published package is built from this branch.**

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
4. [Requirements](docs/REQUIREMENTS.md) — what must be demonstrated and accepted.
5. [Architecture](docs/ARCHITECTURE.md) — hard product/module boundaries.
6. [Support and qualification](docs/SUPPORT-AND-QUALIFICATION.md) — truthful vendor and cloud support.
7. [Roadmap](docs/ROADMAP.md) — gated delivery order.
8. [Decision log](docs/DECISIONS.md) — agreed decisions versus open questions.
9. [Archive and recovery](docs/ARCHIVE.md) — how to inspect or restore previous work.

[Profession requirements register](docs/WORK-REGISTER.md) maps lifecycle outcomes to future Shell and Workbench workflows. [The career taxonomy](docs/data/database-careers.json) captures the complete supplied job-title and technology-specialisation list, while archived activity mappings remain provisional and are not blindly inherited.

## Ground rules

- **Specification before implementation.** No new driver, CLI, Workbench, vendor integration or package until requirements and its qualification criteria are approved.
- **One source of truth for each topic.** Update the appropriate document; do not create a competing blueprint, wave, phase, registry or roadmap.
- **No fake compatibility.** SQL and non-SQL native semantics remain distinct. Catalogue entries are not implemented adapters. Cloud hosting is not equivalent to proven cloud authentication.
- **Preserve history.** Never delete or rewrite the archive; recover useful prior code selectively, after a requirement and interface contract justify it.
- **Docs-only means docs-only.** There is currently no `package.json`, `index.js`, runtime or executable tool on `main`.

Copyright (c) 2026 Stephen J T Spittal. All rights reserved. See [LICENSE](LICENSE).
