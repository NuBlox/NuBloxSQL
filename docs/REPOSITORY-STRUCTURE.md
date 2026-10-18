# Repository structure — implemented architecture

**Reviewed:** 17 October 2026. This document describes the real working source and the reasoning for its folder boundaries. Product scope still belongs to [PRODUCT.md](PRODUCT.md); system architecture belongs to [ARCHITECTURE.md](ARCHITECTURE.md). No empty speculative packages have been created.

## Actual directory tree

~~~text
NuBloxSQL/
├── apps/
│   └── shell/                          Independent CLI via public Driver API
│       ├── package.json
│       └── src/cli.ts
├── packages/
│   └── driver/                         First-party programmable foundation
│       ├── package.json                Public export is dist/index.js only
│       └── src/
│           ├── index.ts                Audited public API surface
│           ├── client.ts               First public model-aware multi-DBMS client
│           ├── operations/
│           │   └── inspect-database.ts Inspection API, safe errors and evidence
│           └── adapters/
│               └── postgresql/
│                   ├── wire.ts         First-party protocol/SCRAM/verified TLS
│                   └── catalog.ts      PostgreSQL-specific introspection SQL
│               └── sqlite/
│                   └── connection.ts   Embedded Node SQLite native interface
├── tests/
│   ├── unit/                           Driver/Shell contracts, no database needed
│   ├── integration/postgresql/         Real PostgreSQL inventory, limits and TLS
│   └── fixtures/postgresql/            Disposable TLS/certificate fixture
├── scripts/check-structure.mjs         Automated source boundary checks
├── docs/                               One authoritative source per topic
├── .github/workflows/                  CI, archive read-only tests and protection
├── package.json                        npm workspace scripts/dependencies
├── package-lock.json                   Reproducible dependency lock
└── tsconfig.base.json                  Strict shared TypeScript settings
~~~

Generated dist/ and node_modules/ remain ignored. The protected archival branch is not a source folder on main.

## Architectural boundaries

| Layer | Responsibility | Forbidden dependency |
| --- | --- | --- |
| packages/driver/src/adapters/<vendor>/ | NuBloxSQL-owned wire protocol, auth, native database semantics and vendor catalogue calls | Apps, professional operation workflows and imported third-party database clients |
| packages/driver/src/operations/ | Public database operations, input/privilege validation, safe errors and work product contracts | Raw protocol framing or vendor-specific SQL definitions |
| packages/driver/src/index.ts | Only audited public Driver exports | Private adapter exports |
| apps/shell/ | CLI, interaction, output files and professional task workflows | Direct Driver internals or vendor DBMS client libraries |
| tests/unit/ | Deterministic contract/security/CLI tests | Requires live PostgreSQL service |
| tests/integration/<vendor>/ | Real database tests and qualification evidence | Claims of production support from unit-only proofs |
| tests/fixtures/<vendor>/ | Disposable test infrastructure | Committed credentials and production deployments |

Current inventory is still **PostgreSQL-specific**, so operations/inspect-database.ts imports its private PostgreSQL adapter. Moving the SQL into adapters/postgresql/catalog.ts makes that boundary concrete. Multi-vendor dispatch comes with a real second adapter and shared public contract, not an invented registry.

## Current multi-vendor Driver proof

The Driver now exposes `connectDatabase` without requiring any application. PostgreSQL (owned wire protocol) and SQLite (Node embedded SQLite interface) share a deliberately narrow relational SQL session. Each preserves its native type/transport differences. Native SQLite SQL is **not** an authored database storage engine, and this is **not** evidence of full SQL vendor or non-SQL support.

The archived first-party **MySQL protocol** is being requalified incrementally: bounded packet framing, v10 greeting, supported authentication challenge tokens and TLS request/response construction are now private primitives under `adapters/mysql/protocol.ts`. There is **no MySQL session or public engine support yet**; real MySQL live TLS/auth/prepared-statement tests must precede `connectDatabase({engine:'mysql'})`. Native type depth, streaming, transactions and model-specific extensions belong in the Driver before adding new product frameworks.

## Why not dozens of packages?

The ultimate NuBloxSQL platform will include independent ORM, query builder, migrations, language/compiler capabilities, Shell, Workbench and other database-profession technologies. They are **in the accepted vision**, but empty package folders are not implementations.

Create new packages only when an independently used, tested public contract justifies their release/consumption. A native vendor adapter can live privately inside the Driver for now; extract a vendor workspace later only when independent lifecycle/versioning and usable exports justify the cost.

The Workbench will belong at apps/workbench/ once its first real graphical workflow is built. No UI code is present today.

## Verification and compatibility

- npm run check:structure enforces actual workspace boundaries, private adapter ownership and test placement.
- npm run build and npm run test:unit, plus real PostgreSQL TLS/inventory/resource CI, must stay green.
- Shell continues importing **only @nubloxsql/driver**; published API/command semantics remain unchanged.
- The existing private experimental path dist/postgresql/wire.js moves to dist/adapters/postgresql/wire.js. It was not exported as a supported public package path; internal protocol tests are updated.
- The [immutable archive](ARCHIVE.md) remains untouched. No pre-reset module is bulk-imported and no public npm package is published.
