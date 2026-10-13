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
│   ├── capabilities/          Capability/SQL language governance
│   ├── client/                Unified public driver client and feature facade
│   │   └── discovery/         Server, security and native-job read-only discovery
│   ├── core/                  Shared SQL-core runtime
│   ├── dialects/              Native engine implementations
│   ├── jobs/                  Internal durable job orchestration foundation
│   └── lifecycle/             Pre-connect engine lifecycle implementation
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

## Driver ownership and grouping

The repository consists of **three distinct products**: `nubloxsql` is the
headless universal SQL driver; `apps/shell/` and `apps/workbench/` are its
terminal and graphical clients. Neither tool owns protocols, SQL compilation
or DBMS semantics.

Within the driver, `lib/client/Client.js` and `index.js` remain the stable
public facade. Feature implementations may be grouped into internal
subdirectories, but their public exports and TypeScript declarations must
not change as a side effect of rearranging source files.

| Directory | Responsibility | Refactoring rule |
| --- | --- | --- |
| `lib/client/discovery/` | Read-only server identity/catalogue, security and native scheduler discovery | The public `discoverDatabaseServer`, `discoverDatabaseSecurity`, `discoverNativeDatabaseJobs` and matching Client methods must continue to work |
| `lib/client/` | Public Client integration and remaining cross-dialect features | Group related modules in later bounded changes only after mapping every dependency and release evidence path |
| `lib/core/` | Shared cross-engine SQL primitives | No application/UI imports |
| `lib/dialects/<engine>/` | Native wire protocols, driver implementations and dialect-local tests | Do not flatten or blend engine-specific behavior |
| `lib/lifecycle/` | Pre-connection engine lifecycle providers | Do not depend on Shell/Workbench |
| `lib/jobs/` | Internal durable job coordination | Reuse qualified public/domain capabilities; avoid independently reimplementing discovery |
| `apps/shell/`, `apps/workbench/` | Separate professional tooling products | Consume only the driver's public API |

**Refactoring sequence:** first group the three read-only discovery modules
and qualify their public API/packaging. A subsequent increment may group
database administration (bootstrap/configuration/security mutation) or
database engineering (schema/migrations/data movement) if a dependency audit
shows a coherent boundary. Avoid a whole-repository directory shuffle:
package release manifests, test and evidence references, and downstream
import paths must be updated atomically with each move.

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
