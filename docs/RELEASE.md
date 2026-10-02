# Release Status

## Release line

NuBloxSQL is versioned as **1.1.0** in `package.json` and is distributed as the single public package `nubloxsql`.

The release architecture is one package, one public API, consolidated native dialect runtimes, zero declared third-party npm dependencies, and a proprietary licence.

## Qualification status

Tier-1 qualification is closed for:

- PostgreSQL 15, 16, 17 and 18;
- MySQL 8.4 and 9.7;
- SQLite on Node.js 22, 24 and 26, including production performance, memory, WAL/rollback contention and corrupt-input hardening evidence.

Shared Tier-1 contracts include the portable metadata vocabulary and the versioned `client.diagnose()` query-diagnostics surface. The diagnostics contract normalizes common plan evidence while retaining each engine's complete native report; PostgreSQL and MySQL support execution analysis, while SQLite provides plan/opcode diagnostics without a portable EXPLAIN ANALYZE claim.

SQL Server remains a supported Tier-2 native runtime and is covered by its own regression and live qualification suites. It is not currently included in the shared portable query-diagnostics contract.

## Release gates

A release candidate is acceptable only when these pass:

```bash
npm run verify
npm run test:sqlite-production
npm run release:check
```

`release:check` enforces the consolidated package boundary, proprietary release rules, public API package manifest, clean-install consumer qualification, TypeScript consumer qualification and Tier-1 evidence manifest.

## Source of truth

Current release claims must be supported by implementation and automated evidence. The machine-readable contracts are:

- `docs/releases/public-api-v1.json`
- `docs/releases/tier1-stable-evidence.json`

Historical engineering notes are archived and do not override these contracts.
