# NuBloxSQL Documentation

This directory contains the **authoritative release documentation** for the current NuBloxSQL repository state.

## Current documents

- [Release status](RELEASE.md) — current release line, qualification and release gates.
- [Support matrix](SUPPORT.md) — supported Node.js and database-engine scope.
- [Public API](API.md) — concise supported public developer surface.
- [1.1.0 release notes](releases/1.1.0.md) — current release-line notes.

## Machine-readable release contracts

- `releases/public-api-v1.json` — packaged public API and package-surface contract.
- `releases/tier1-stable-evidence.json` — Tier-1 qualification evidence manifest.

These contracts are consumed by repository release tooling and are not informal documentation.

## Archive

Everything under [`archive/`](archive/) is historical material retained for traceability. Archived files may contain superseded status, package names, plans, assumptions or qualification narratives. **Do not use archived material as current release guidance.**

If a statement conflicts with the root `README.md`, this directory's current documents, the public type declarations, or release-check tooling, the archived statement is obsolete.
