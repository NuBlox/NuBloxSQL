# NuBloxSQL Documentation

NuBloxSQL documentation describes one product: **the single-entry, multi-dialect SQL database integration platform for developers**.

## Start here

1. [Repository README](../README.md) — install, public API and current product status.
2. [Design intent](architecture/design-intent.md) — why NuBloxSQL exists and the one-entry-point contract.
3. [Multi-dialect architecture](architecture/multi-dialect.md) — facade, shared contracts and native runtimes.
4. [Roadmap](../NUBLOX-SQL-ROADMAP.md) — current and planned engineering sequence.
5. [Documentation standard](STYLE.md) — terminology and source-of-truth rules.

## Runtime source layout

NuBloxSQL is published and consumed as one package. Its internal source boundaries are implementation modules, not separately installed packages:

```text
lib/
├── core/                  # shared, proven SQL contracts
└── dialects/
    ├── mysql/             # native MySQL runtime
    ├── postgresql/        # native PostgreSQL runtime
    └── sqlite/            # embedded SQLite runtime
```

Current runtime behavior is documented by the root README and architecture documents rather than duplicated per-dialect package READMEs.

## Stable v1 release record

The `docs/v1/` directory records the stable v1 historical baseline and qualification evidence:

- [Release notes](v1/V1-RELEASE-NOTES.md)
- [Support matrix](v1/V1-SUPPORT-MATRIX.md)
- [Migration guide](v1/V1-MIGRATION.md)
- [Release completion record](v1/V1-RELEASE-PLAN.md)
- [SQL Core v1 contract](v1/SQL-CORE-V1-CONTRACT.md)
- [Proprietary release gate](v1/PROPRIETARY-IP-RELEASE-GATE.md)

Historical documents may describe package boundaries used during the v1 development and release process. Current architecture is owned by the root README and architecture documents above.
