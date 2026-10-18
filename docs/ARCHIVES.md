# NuBloxSQL preserved archives

| Archive | Snapshot commit | Content |
| --- | --- | --- |
| [Historical implementation](https://github.com/NuBlox/NuBloxSQL/tree/archive/legacy-implementation-2026-10-16) | **4ed0e35fbfe71ac110c9ec41cf62ba3355e9d56c** | Earlier database adapters, query/migrations, Shell, Workbench and supporting code |
| [Pre-definition implementation](https://github.com/NuBlox/NuBloxSQL/tree/archive/pre-definition-reset-2026-10-18) | **8beb6cc9920494d9bfbf8756bddece3a8492018f** | Later experimental PostgreSQL/SQLite client, MySQL protocol primitives, Shell, CI, tests and old plans |

Both archives are *preserved sources*, not active software support or binding architecture. Prior commits and published packages are not erased; their historical licence grants remain in force.

**Branch protection:** The older archive has an active GitHub no-update/no-delete/no-force-push ruleset. The new pre-definition branch has been created and verified, but is **not yet protected against modification or deletion**. A repository administrator must add and verify an exact-branch immutable ruleset.

## Reuse rule

Recover code only after the product definition and a concrete complete workflow establish a need. Inspect provenance, dependencies, security and live-engine test evidence for each candidate. Do not mass-import old work, resurrect old roadmaps or treat archive tests as current qualification.

The active product definition lives in [PRODUCT.md](PRODUCT.md).
