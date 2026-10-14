# Repository Structure

This document defines the intended NuBloxSQL repository layout. New files should follow this structure instead of creating new top-level areas casually.

```text
NuBloxSQL/
├── apps/
│   ├── shell/                 NuBloxSQL Shell: terminal and automation
│   └── workbench/             NuBloxSQL Workbench: graphical professional tool
├── docs/
│   ├── architecture/          Detailed system/design architecture
│   ├── cookbook/              Worked public recipes
│   ├── guides/                Public task-oriented guides
│   ├── product/               Product blueprint, capability register, roadmap
│   ├── releases/              Current machine-readable contracts + release notes
│   ├── API.md
│   ├── RELEASE.md
│   ├── SUPPORT.md
│   └── README.md
├── lib/
│   ├── capabilities/          SQL dialect, parser/compiler and capability ontology
│   ├── catalog/               Vendor/model and cloud-service reference catalogues
│   ├── client/                Public driver client façade and shared runtime
│   │   ├── administration/    Bootstrap and configuration plans/execution
│   │   ├── discovery/         Server, security and native-job discovery
│   │   ├── engineering/       Schema/diff, migration and data movement
│   │   └── runtime/           SQL result and prepared-parameter helpers
│   ├── core/                  Shared SQL-core runtime
│   ├── dialects/              Native engine implementations
│   ├── jobs/                  Internal durable job orchestration foundation
│   ├── lifecycle/             Pre-connect engine lifecycle implementation
│   └── runtime/               Lazy SQL router and native adapter contracts
├── scripts/                   Repository/release qualification scripts
├── test/                      Cross-cutting package/integration tests
├── types/                     Public TypeScript declarations
├── index.js
├── index.d.ts
├── package.json
├── README.md
├── LICENSE
└── NOTICE
```

## Database vendor and cloud implementation boundaries

The existing SQL dialect registry remains under `lib/capabilities/` and is distinct from `lib/catalog/DatabaseTechnologyRegistry.js` (SQL and non-SQL model catalogue) and `lib/catalog/CloudDatabaseRegistry.js` (managed-cloud service placement and credential-free connection requirements). Only the four qualified native SQL adapters currently exist under `lib/dialects/`. Catalogue records are not connectors. New SQL/non-SQL protocol adapters must be isolated under their own qualified runtime and must not pull cloud identity, secret persistence or vendor UI into the shared driver.

## Driver ownership and grouping

The repository consists of **three distinct products**: `nubloxsql` is the
headless universal database driver; `apps/shell/` and `apps/workbench/` are its
terminal and graphical clients. Neither tool owns protocols, SQL compilation
or DBMS semantics.

Within the driver, `lib/client/Client.js` and `index.js` remain the stable
public facade. Feature implementations may be grouped into internal
subdirectories, but their public exports and TypeScript declarations must
not change as a side effect of rearranging source files.

| Directory | Responsibility | Refactoring rule |
| --- | --- | --- |
| `lib/catalog/` | Vendor, technology, model and cloud profile catalogue, separate from SQL grammar | Read-only, no imported runtime/client/application, catalogue is not connection support |
| `lib/client/administration/` | Database bootstrap and configuration | Preserve public plan/inspect/execute contracts and plan integrity |
| `lib/client/discovery/` | Read-only server identity/catalogue, security and native scheduler discovery | Preserve public `discoverDatabaseServer`, `discoverDatabaseSecurity`, `discoverNativeDatabaseJobs` and Client methods |
| `lib/client/engineering/` | Schema object identity, dependency graph, diff, migration and data movement | Preserve public planning/execution semantics and safety controls |
| `lib/client/runtime/` | SQL-specific result and prepared-parameter normalisation | Preserve `Client.js` helper exports and qualified dialect semantics; do not conflate with native cross-model adapter contract |
| `lib/client/` | Public Client integration and remaining cross-dialect features | Group related modules in later bounded changes only after mapping every dependency and release evidence path |
| `lib/runtime/` | Internal lazy SQL routing and model-neutral native adapter contracts | Unsupported vendor entries cannot be routed; preserve SQL entry point, URL aliases and lazy imports |
| `lib/core/` | Shared cross-engine SQL primitives | No application/UI imports |
| `lib/dialects/<engine>/` | Native wire protocols, driver implementations and dialect-local tests | Do not flatten or blend engine-specific behavior |
| `lib/lifecycle/` | Pre-connection engine lifecycle providers | Do not depend on Shell/Workbench |
| `lib/jobs/` | Internal durable job coordination | Reuse qualified public/domain capabilities; avoid independently reimplementing discovery |
| `apps/shell/`, `apps/workbench/` | Separate professional tooling products | Consume only the driver's public API |

**Refactoring sequence:** discovery, catalogue, database administration and
database engineering have been grouped with package/evidence migration and
regression checks. The lazy SQL adapter router and native module contract have
also been extracted into `lib/runtime/`. Subsequent work should partition remaining public client
runtime integrations, preserve dialect-local protocol separation, make SQL
parser/compile layers easier to maintain, and independently organize Shell/
Workbench workflows. Avoid a single whole-repository directory shuffle:
package release manifests, tests and documentation must always advance with
each move. See [Refactoring Programme](REFACTOR-PROGRAMME.md).

All implementation moves require the existing tests, live dialect suites
where affected, `npm run verify:release`, `npm run release:qualify` and
`npm pack --dry-run` to pass. No published package import or exported name
may be removed without an explicit breaking-change decision.

## Rules

- `lib/` is the production runtime and remains dependency-free at the npm package boundary.
- `apps/` contains **NuBloxSQL Shell** and **NuBloxSQL Workbench**, two tools for database professionals. Both consume the public universal SQL driver API and remain outside the `nubloxsql` package runtime.
- `docs/product/BLUEPRINT.md` is the product authority.
- `docs/architecture/` contains implementation/design models, not historical notes.
- `scripts/` replaces the ambiguous historical `tool/` directory.
- `packages/`, root `shell/`, `tool/`, `docs/strategy/`, and `docs/archive/` must not reappear.
- Release contracts may reference current source/docs only; superseded contracts remain available through Git history rather than the active tree.
- Tests may remain under the current root `test/` while their execution is centrally orchestrated; avoid large path-only test moves unless there is a functional reason.
- Dialect-local tests remain with their dialect runtime because they qualify native implementation behaviour.

A release check enforces these top-level boundaries.
