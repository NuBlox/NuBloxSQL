# NuBloxSQL Documentation

NuBloxSQL documentation describes one product: **the single-entry, multi-dialect SQL database integration platform for developers**.

## Start here

1. [Repository README](../README.md) — install, public API and current product status.
2. [Design intent](architecture/design-intent.md) — why NuBloxSQL exists and the one-entry-point contract.
3. [Multi-dialect architecture](architecture/multi-dialect.md) — facade, shared contracts and native runtimes.
4. [Roadmap](../NUBLOX-SQL-ROADMAP.md) — current and planned engineering sequence.
5. [Documentation standard](STYLE.md) — terminology and source-of-truth rules.

## Internal runtime documentation

These READMEs document implementation workspaces inside NuBloxSQL. They are not the normal developer installation path.

- [SQL Core](../packages/sql-core/README.md)
- [MySQL runtime](../packages/mysql/README.md)
- [PostgreSQL runtime](../packages/postgresql/README.md)
- [SQLite runtime](../packages/sqlite/README.md)

## Stable v1 release record

The `docs/v1/` directory records the stable v1 historical baseline and qualification evidence:

- [Release notes](v1/V1-RELEASE-NOTES.md)
- [Support matrix](v1/V1-SUPPORT-MATRIX.md)
- [Migration guide](v1/V1-MIGRATION.md)
- [Release completion record](v1/V1-RELEASE-PLAN.md)
- [SQL Core v1 contract](v1/SQL-CORE-V1-CONTRACT.md)
- [Proprietary release gate](v1/PROPRIETARY-IP-RELEASE-GATE.md)

Historical documents may describe the package boundaries used by that release. Current public design intent is owned by the root README and architecture documents above.
