# NuBloxSQL

**Status: proprietary, ground-up native-driver implementation underway. Private PostgreSQL protocol v3 Driver and independent Shell now include first-party certificate-verified TLS tested against a disposable PostgreSQL 17 endpoint. Managed-cloud/remote environments, Workbench and a complete TASK-001 release remain unqualified or unimplemented. Nothing in the reboot is published.**

**Immediate focus: make NuBloxSQL Driver the most capable universal native DBMS client we can prove through real-engine tests.** The broader platform remains a long-term vision, but Driver development now takes precedence over Shell, Workbench, ORM and unrelated tooling.

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
   [Implemented repository structure](docs/REPOSITORY-STRUCTURE.md) — real directories, ownership and automated boundary checks.
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

## Public multi-engine native client — experimental

The Driver now exports `connectDatabase()` from `@nubloxsql/driver`. A typed relational `SqlDatabaseSession` performs real parameter-bound queries through **two** explicitly distinguished native adapters: the **NuBloxSQL-owned PostgreSQL wire protocol**, and **embedded SQLite via Node's built-in `node:sqlite` interface** (as the archived NuBloxSQL SQLite implementation did). SQLite uses the platform-provided database engine; we do not claim to have authored its storage engine.

```ts
import {connectDatabase} from '@nubloxsql/driver';

const session = await connectDatabase({engine:'sqlite', mode:'memory'});
try {
  await session.query('CREATE TABLE demo(id INTEGER PRIMARY KEY, label TEXT NOT NULL)');
  await session.query('INSERT INTO demo(label) VALUES (?)', ['NuBloxSQL']);
  console.log((await session.query('SELECT id, label FROM demo')).rows);
} finally {
  await session.close();
}
```

The API exposes the actual relational model, engine, transport and narrowly evidenced capabilities, refusing unsupported vendors and other data models rather than routing them through misleading SQL compatibility. SQLite returns native BigInt integers; the current limited PostgreSQL client returns text-decoded values. Query execution respects real database privileges and does **not** impose a universal read-only guarantee.

**Next Driver milestone:** complete the archived **first-party MySQL protocol** requalification and prove the same public API with a third real SQL engine. A private, unit-tested MySQL packet/handshake/auth/TLS-request foundation now exists, but **cannot yet connect or query MySQL**; production claims and public routing remain blocked until live native TLS/auth/prepared-query tests pass. Then add deeper native types, transactions, cancellation, streaming/pooling, non-SQL model-native adapters, cloud identities and measurable performance. Shell, Workbench and ORM development are deferred, not deleted.

## First executable slice — not a released product

The `@nubloxsql/driver` private TypeScript package implements **read-only PostgreSQL 17 inventory using NuBloxSQL-owned wire framing, SCRAM authentication and native query flow**, not a third-party PostgreSQL driver. It returns scoped catalog metadata, safe error codes, explicit transport policy, finite limits and redacted output. The independent `@nubloxsql/shell` package calls its **public API** to write a protected JSON work product. Both are experimental; Workbench is not yet implemented.

The first-party PostgreSQL wire client permits either explicit **isolated loopback plaintext** or mandatory **verified TLS** (PostgreSQL SSLRequest, certificate-chain validation and exact target identity). The Driver and Shell TLS paths are tested with an ephemeral CA-signed PostgreSQL 17 fixture, including unknown-CA and trusted-but-wrong-hostname failures and downgrade refusal. For Shell custom trust anchors, set `NUBLOXSQL_PG_SECURITY=verified-tls` and `NUBLOXSQL_PG_CA_FILE` to a trusted PEM CA file; credentials remain environment-sourced. **SCRAM-SHA-256 is currently limited to ASCII passwords; SCRAM-PLUS/channel binding, cloud IAM, proxy/private endpoints and non-local server combinations remain unqualified.** Source API and work-product details are in [TASK-001](docs/TASK-001.md).

On Node.js 24, run `npm ci`, `npm run build` and `npm run test:unit`. Live tests run against a digest-pinned PostgreSQL 17 CI service. The Shell requires an explicit `NUBLOXSQL_PG_SECURITY` value (`isolated-local` or `verified-tls`) and an environment-based secret; it does not accept a password on the command line. **Do not publish** the private package or claim production support.

## Ground rules

- **Mission before implementation.** Every Driver, ORM, query builder, Shell, Workbench or other feature must trace to a professional or developer outcome, accepted interfaces and qualification evidence.
- **One source of truth for each topic.** Update the appropriate document; do not create a competing blueprint, wave, phase, registry or roadmap.
- **No fake compatibility or superiority.** SQL and non-SQL native semantics remain distinct, interoperability needs evidence, a catalogue entry is not an adapter, and comparative superiority needs reproducible benchmarking.
- **Preserve history.** Never delete or rewrite the archive; recover useful prior code selectively, after a requirement and interface contract justify it.
- **Incremental qualification:** private TypeScript packages may now be introduced only for approved TASK-001 outcomes; live tests and work-product evidence are mandatory before support claims. Avoid unrelated feature expansion.

Copyright (c) 2026 Stephen J T Spittal. All rights reserved. See [LICENSE](LICENSE).
