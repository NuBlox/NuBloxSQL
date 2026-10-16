# Work register — outcomes first

**Status:** Initial priority shortlist; it does **not** assert that work has been implemented.

A database career title is not a permission, role assignment or feature. Capture each activity as an auditable work product, connected to native capabilities and both professional tools.

| Task | Outcome / work product | Phase | Priority | Demonstration |
| --- | --- | --- | --- | --- |
| TASK-001 | Server identity and versioned database inventory | Discover | First vertical slice | Real engine → Driver → Shell + Workbench → equivalent exported report |
| TASK-002 | Secure, reusable database connection profile | Discover/Establish | First vertical slice | TLS/auth failure and secure reconnection cases |
| TASK-003 | Metadata-backed table and schema inspection | Discover/Understand | First release candidate | Native metadata and accurate field provenance |
| TASK-004 | Run a bounded native query and export results | Use | First release candidate | Parameter binding, cancel, size/timeout quotas |
| TASK-005 | Inspect privileges and configuration | Establish/Operate | Later | Native privileges with explicit unsupported cases |
| TASK-006 | Diagnose query plans and blocking | Understand/Operate | Later | Real query plans, timeouts and diagnostic evidence |
| TASK-007 | Plan and apply schema changes | Build/Change | Later | Approval, preview, rollback and verified change |
| TASK-008 | Verify backup and recovery | Operate | Later | Restore test in disposable environment |
| TASK-009 | Qualify database/edition choice | Select | Later | Comparable, version-specific selection record |
| TASK-010 | Install and initialize an engine | Install/Initialize | Later | Prerequisite assessment, provider safety and readiness |
| TASK-011 | Upgrade/migrate a database | Change | Later | Compatibility assessment and resumable evidence |
| TASK-012 | Secure retirement and decommission | Retire | Later | Approved, retention-aware disposal record |

## Task completion definition

Each task needs a unique ID, actor, starting state, target DBMS/version, required authorisations, inputs, operation semantics, failure strategy, final state, work-product schema, Shell interface, Workbench interface, tests and evidence paths. Both tools must use the Driver public API. **UI coverage without a complete verified result is not completion.**

## Existing profession catalogue

The archived design-input register contains **6 tracks, 18 families, 40 candidate activities and 11 phases**, plus career examples. It remains accessible at [archived database-profession-work-register.json](https://github.com/NuBlox/NuBloxSQL/blob/archive/legacy-implementation-2026-10-16/docs/product/database-profession-work-register.json). Do not copy it wholesale into the new baseline. Review tasks for actual database responsibility, boundary with downstream analytics, duplicate activities, missing governance work and acceptance criteria.

Before code begins, validate TASK-001 and TASK-002 in [REQUIREMENTS.md](REQUIREMENTS.md), including a real target engine and their work-product output contracts.
