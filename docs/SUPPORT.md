# Support Matrix

## Runtime

NuBloxSQL requires **Node.js 22 or newer**. The active qualification matrix covers Node.js **22, 24 and 26**.

## Database support

| Dialect | Tier | Qualified scope | Runtime model |
| --- | --- | --- | --- |
| PostgreSQL | Tier 1 | PostgreSQL 15, 16, 17 and 18 | Native client/server protocol |
| MySQL | Tier 1 | MySQL 8.4 and 9.7 | Native client/server protocol |
| SQLite | Tier 1 | `node:sqlite` on Node.js 22, 24 and 26 | Embedded runtime |
| SQL Server | Tier 2 | Supported native runtime with dedicated regression/live suites | Native TDS runtime |

## What "qualified" means

A qualified Tier-1 claim is backed by implementation, automated regression coverage, failure-path evidence and a supported-version matrix. External server dialects are exercised against the listed server versions; SQLite is exercised across the supported Node.js matrix, including production performance, memory, concurrency and corrupt-input hardening evidence.

Versions outside the table may work, but they are not part of the current release qualification claim.

The machine-readable qualification record is `docs/releases/tier1-stable-evidence.json`.
