# Repository Structure

This document defines the intended NuBloxSQL repository layout. New files should follow this structure instead of creating new top-level areas casually.

```text
NuBloxSQL/
├── apps/
│   └── shell/                 Official downstream CLI application
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
│   ├── client/                Unified public client implementation
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

## Rules

- `lib/` is the production runtime and remains dependency-free at the npm package boundary.
- `apps/` contains products that consume NuBloxSQL but are not part of the `nubloxsql` package runtime.
- `docs/product/BLUEPRINT.md` is the product authority.
- `docs/architecture/` contains implementation/design models, not historical notes.
- `scripts/` replaces the ambiguous historical `tool/` directory.
- `packages/`, root `shell/`, `tool/`, `docs/strategy/`, and `docs/archive/` must not reappear.
- Release contracts may reference current source/docs only; superseded contracts remain available through Git history rather than the active tree.
- Tests may remain under the current root `test/` while their execution is centrally orchestrated; avoid large path-only test moves unless there is a functional reason.
- Dialect-local tests remain with their dialect runtime because they qualify native implementation behaviour.

A release check enforces these top-level boundaries.
