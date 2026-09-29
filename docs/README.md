# NuBloxSQL Documentation

This is the documentation map for the NuBloxSQL platform.

## Read in this order

1. [Repository overview](../README.md) — what NuBloxSQL is and the current package/runtime state.
2. [Design intent](architecture/design-intent.md) — why the platform exists and the architectural rules it must preserve.
3. [Multi-dialect architecture](architecture/multi-dialect.md) — how the platform is partitioned into contracts, dialect services, adapter runtimes and consumers.
4. [Roadmap](../NUBLOX-SQL-ROADMAP.md) — the active engineering sequence.
5. Package READMEs — concrete package APIs, capabilities and native semantics.
6. `docs/v1/` — frozen release evidence for the stable v1.0.0 baseline.

## Current platform documentation

| Document | Owns |
| --- | --- |
| [`README.md`](../README.md) | Current platform and package status |
| [`architecture/design-intent.md`](architecture/design-intent.md) | Product intent and architectural invariants |
| [`architecture/multi-dialect.md`](architecture/multi-dialect.md) | Current technical architecture and boundaries |
| [`NUBLOX-SQL-ROADMAP.md`](../NUBLOX-SQL-ROADMAP.md) | Forward engineering sequence |
| [`STYLE.md`](STYLE.md) | Documentation structure and terminology |

## Package documentation

Every package README follows the same structural contract but documents the package's actual role.

- [`@nublox/sql-core`](../packages/sql-core/README.md) — platform contracts and portable vocabulary.
- [`@nublox/mysql`](../packages/mysql/README.md) — native MySQL runtime.
- [`@nublox/postgresql`](../packages/postgresql/README.md) — native PostgreSQL runtime.
- [`@nublox/sqlite`](../packages/sqlite/README.md) — embedded SQLite runtime under development.

Planned adapters are documented in the roadmap until an implementation package exists.

## Stable v1.0.0 release record

The v1 directory is release evidence, not the place to describe current post-v1 architecture.

- [Release notes](v1/V1-RELEASE-NOTES.md)
- [Support matrix](v1/V1-SUPPORT-MATRIX.md)
- [Migration guide](v1/V1-MIGRATION.md)
- [Release completion record](v1/V1-RELEASE-PLAN.md)
- [SQL Core v1 contract](v1/SQL-CORE-V1-CONTRACT.md)
- [Proprietary/IP release gate](v1/PROPRIETARY-IP-RELEASE-GATE.md)
- [Gate evidence](v1/GATE-1-EVIDENCE.md)
- [Gate evidence](v1/GATE-3-EVIDENCE.md)
- [Gate evidence](v1/GATE-4-EVIDENCE.md)
- [Gate evidence](v1/GATE-5-EVIDENCE.md)

## Documentation rule

The documents should tell one consistent story:

> NuBloxSQL is one platform, `@nublox/sql-core` defines the portable contract vocabulary, adapters own real database semantics, and consumer products depend on those adapters instead of owning database transports themselves.
