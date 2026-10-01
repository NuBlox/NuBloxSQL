# NuBloxSQL Documentation

This directory contains the **authoritative release documentation** for the current NuBloxSQL repository state.

## User guides

The [NuBloxSQL User Guides](guides/README.md) are the detailed task-oriented documentation for application developers. They cover installation, connections and pooling, SQL and binding, prepared statements, transactions, streaming and cancellation, metadata/introspection, errors and recovery, observability/type codecs, dialect-specific behaviour, capability/portability tooling, TypeScript and production troubleshooting.

## Worked cookbook

The [NuBloxSQL Cookbook](cookbook/README.md) contains worked application recipes. It covers portable CRUD, joins/CTEs/reporting, transactions/retries, large-result streaming, metadata tools, query diagnostics, PostgreSQL/MySQL/SQLite/SQL Server service patterns, bulk data movement, observability and migration analysis.

Use guides to understand the contract; use cookbook recipes to see several APIs combined into realistic flows.

## Release documents

- [Release status](RELEASE.md) — current release line, qualification and release gates.
- [Support matrix](SUPPORT.md) — supported Node.js and database-engine scope.
- [Public API](API.md) — concise supported public developer surface.
- [1.1.0 release notes](releases/1.1.0.md) — current release-line notes.

## Machine-readable release contracts

- `releases/public-api-v1.json` — packaged public API and package-surface contract.
- `releases/tier1-stable-evidence.json` — Tier-1 qualification evidence manifest.

These contracts are consumed by repository release tooling and are not informal documentation.

## Documentation validity

The root README, this directory's current documents, `docs/guides/`, `docs/cookbook/`, the public TypeScript declarations and release-check tooling describe the current release. Guides and cookbook recipes are checked by the release audit for presence and valid relative links.

## Archive

Everything under [`archive/`](archive/) is historical material retained for traceability. Archived files may contain superseded status, package names, plans, assumptions or qualification narratives. **Do not use archived material as current release guidance.**

If an archived statement conflicts with current release documentation, declarations or release tooling, the archived statement is obsolete.
