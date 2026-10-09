# NuBloxSQL Documentation

This directory contains the authoritative documentation for the current NuBloxSQL repository state.

## Product authority

Use these documents in this order:

1. [Product Blueprint](product/BLUEPRINT.md) — single authority for product scope, domains, lifecycle interpretation, boundaries and frozen development sequence.
2. [Capability Register](product/CAPABILITY-REGISTER.md) — current whole-product maturity and evidence.
3. [Roadmap](product/ROADMAP.md) — ordered implementation programme.
4. [Database Lifecycle](architecture/DATABASE-LIFECYCLE.md) — detailed lifecycle architecture.
5. [Database Jobs](architecture/DATABASE-JOBS.md) — durable job/workflow architecture.
6. [Repository Structure](architecture/REPOSITORY-STRUCTURE.md) — repository layout and placement rules.

The [Competitive Benchmark](product/COMPETITIVE-BENCHMARK.md) informs capability breadth but does not override the Product Blueprint.

## Public documentation

- [User Guides](guides/README.md) — task-oriented developer and operator guidance.
- [Cookbook](cookbook/README.md) — worked application recipes.
- [Public API](API.md) — concise supported developer surface.
- [Support Matrix](SUPPORT.md) — supported Node.js and database-engine scope.
- [Release Status](RELEASE.md) — release line and qualification gates.

## Official applications

- [NuBlox Shell](architecture/SHELL.md) — terminal application architecture. Implementation lives under `apps/shell/`.

## Machine-readable release contracts

Current release contracts live under `releases/`:

- `public-api-v1.json`
- `tier1-stable-evidence.json`
- `product-coverage-v2.json`
- `product-lifecycle-v2.json`

Historical contracts do not remain in the active release-contract directory. The superseded lifecycle-v1 contract is retained under `archive/contracts/`.

## Archive

Everything under [`archive/`](archive/) is historical and non-authoritative. Archived material may preserve superseded package names, support claims, plans, architecture or qualification evidence for traceability only.

When documents conflict, follow the authority order in the Product Blueprint.
