# NuBloxSQL Documentation

This directory is the documentation entry point for the NuBloxSQL repository.

## Documentation model

NuBloxSQL documentation is divided into four classes so current product truth is not mixed with historical release evidence.

| Class | Purpose | Authority |
| --- | --- | --- |
| Product | What NuBloxSQL is now | `README.md` |
| Architecture | Current technical boundaries and design rules | `docs/architecture/` |
| Roadmap | Current and planned development | `NUBLOX-SQL-ROADMAP.md` |
| Release record | Frozen evidence and guidance for a specific release | `docs/v1/` |

Package READMEs describe package-specific usage and supported surfaces. They should not redefine repository-wide architecture or release policy.

## Current product documentation

- [Repository overview](../README.md)
- [Multi-dialect architecture](architecture/multi-dialect.md)
- [Development roadmap](../NUBLOX-SQL-ROADMAP.md)

## Package documentation

- [`@nublox/sql-core`](../packages/sql-core/README.md)
- [`@nublox/mysql`](../packages/mysql/README.md)
- [`@nublox/postgresql`](../packages/postgresql/README.md)
- [`@nublox/sqlite`](../packages/sqlite/README.md)

## Stable v1.0.0 release record

The `docs/v1/` directory records the stable three-package v1.0.0 baseline. These documents are historical release evidence unless explicitly stated otherwise.

- [Release notes](v1/V1-RELEASE-NOTES.md)
- [Support matrix](v1/V1-SUPPORT-MATRIX.md)
- [Migration guide](v1/V1-MIGRATION.md)
- [Release plan and completion record](v1/V1-RELEASE-PLAN.md)
- [SQL Core v1 contract](v1/SQL-CORE-V1-CONTRACT.md)
- [Proprietary release gate](v1/PROPRIETARY-IP-RELEASE-GATE.md)
- [Gate 1 evidence](v1/GATE-1-EVIDENCE.md)
- [Gate 3 evidence](v1/GATE-3-EVIDENCE.md)
- [Gate 4 evidence](v1/GATE-4-EVIDENCE.md)
- [Gate 5 evidence](v1/GATE-5-EVIDENCE.md)

## Documentation conventions

See [STYLE.md](STYLE.md). The core rule is simple: one document owns each kind of truth, and other documents link to it instead of restating mutable facts unnecessarily.
