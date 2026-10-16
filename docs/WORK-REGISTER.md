# Database professional work register — activities and work products

**Status:** Requirements discovery, not approved scope, vendor support or implemented software. The [canonical structured activity catalogue](data/database-work-activities.json) is the **single source of truth** for all activity names, career mappings, lifecycle phases, work products, candidate capability needs, evidence criteria and provenance. This document explains and prioritises it, without duplicating 64 records.

## Audited baseline — 16 October 2026

- **40 archived candidate activities** retained with their original `a01`–`a40` IDs in `source.legacyActivityId`, cross-checked against the archived profession work register.
- **24 additional candidates** (`ACT-041` through `ACT-064`) for observed workflow gaps, especially discovery and query governance, secure initialisation, cloud qualification, restore and retirement evidence.
- **64 proposed activities total:** 27 primary governance activities and 37 primary delivery activities.
- **128 listed work-product entries**, with one or more proposed acceptance-evidence statements for each activity.
- **All 18 career families represented.** This is a coverage check, not proof that each individual of 240 job titles has a unique task.
- **Scope review:** 57 database-scoped, 6 database-adjacent and 1 out-of-product activity. Scope classification remains a candidate subject to review.

## Phase × workstream coverage

Each activity can appear in more than one phase; counts below are **assignments**, not distinct activities.

| Lifecycle phase | Governance candidates | Delivery candidates |
| --- | ---: | ---: |
| Select | 6 | 2 |
| Install | 2 | 3 |
| Initialize | 2 | 2 |
| Discover | 1 | 4 |
| Establish | 4 | 4 |
| Build | 3 | 11 |
| Use | 1 | 9 |
| Understand | 5 | 6 |
| Operate | 7 | 10 |
| Change | 6 | 8 |
| Retire | 2 | 2 |

No phase has an empty primary governance or delivery column. This closes the *identified mapping gap* in the seed data but does **not** establish that the catalogue is complete or the activities are in product scope.

## What the record means

Each `ACT-###` has: a stable ID, title, source and original legacy ID (if any), review status, primary governance/delivery workstream, scope class, lifecycle phase(s), linked `family-##` IDs, product domain(s), expected work products, desired native capability areas, related outcome `TASK-###` IDs where clearly relevant, and a concrete testable evidence criterion.

**Workstream is not access:** governance describes a decision/policy/evidence function; delivery describes execution/verification. Privileges require separately authenticated identity, native DBMS grants, target/risk-specific approval, and auditability.

**Scope is not implementation:** every capability, Shell command, Workbench journey, vendor and cloud integration is proposed until specified, coded, live-tested and released. Native SQL and non-SQL model behaviours must remain distinct.

**Adjacent work stays bounded:** e.g. database-side data extraction for a BI engineer, metadata evidence for governance, or vector/index primitives for AI engineering may be useful; building a complete BI dashboard, ML training system or DBMS storage engine is not the mission.

## The first 12 traceable outcomes

| Task | Outcome / work product | Phase(s) | Provisional stage | Evidence direction |
| --- | --- | --- | --- | --- |
| TASK-001 | Server identity and versioned database inventory | Discover | First vertical slice | Live DBMS → Driver → Shell + Workbench → matching structured export |
| TASK-002 | Secure, reusable connection profile | Discover, Establish | First vertical slice | Negative TLS/auth, credentials and reconnect checks |
| TASK-003 | Metadata-backed schema inspection | Discover, Understand | First candidate release | Native inventory, privilege scoping and field provenance |
| TASK-004 | Bounded native operation and export | Use | First candidate release | Typed values, safe parameters, limits and cancellation |
| TASK-005 | Configuration, access and privilege inspection | Establish, Operate | Later | Native configuration/grants, explicit negative tests |
| TASK-006 | Diagnostics and capacity evidence | Understand, Operate | Later | Live explain, health, session/lock and workload evidence |
| TASK-007 | Review and apply schema changes | Build, Change | Later | Schema snapshots, approvals, rollback/irreversibility evidence |
| TASK-008 | Backup and verified recovery | Operate | Later | Disposable backup-and-restore acceptance |
| TASK-009 | Qualify engine choice | Select | Later | Vendor/version, deployment and capability decision |
| TASK-010 | Install and initialise | Install, Initialize | Later | Provider-scoped installation and readiness evidence |
| TASK-011 | Upgrade or migrate | Change | Later | Real cutover, reconciliation, recovery/rollback evidence |
| TASK-012 | Retire/decommission | Retire | Later | Retention, access revocation and disposal verification |

These outcomes are **workflows**, not a duplicate activity list. Many activities may contribute to one task, and some profession research/strategic activities are not automatically a NuBloxSQL function.

## Requirements gate before development

1. Validate each candidate with an appropriate subject-matter expert; decide retain, split, merge, defer or exclude, preserving immutable IDs and provenance.
2. Record accountable role(s), triggering event, prerequisites, approved scope, starting/final state and privileges for any chosen activity.
3. Define **machine-readable work-product schema(s)** and specific failure/rollback outcomes.
4. For each selected task, specify **Driver public API**, **Shell scriptable workflow**, **Workbench guided workflow** and common evidence format; native capability gaps are explicit.
5. Trace acceptance against reproducible real database engine/version tests. Neither a role title nor a mock-only test qualifies a vendor.
6. Only promote reviewed candidate requirements into [REQUIREMENTS.md](REQUIREMENTS.md), with stable PRD IDs and separate source tests.

This register uses the user-supplied [career taxonomy](CAREERS.md), the authoritative [product scope](PRODUCT.md), and the [11-phase lifecycle](USERS-AND-LIFECYCLE.md). The complete previous implementation and original 40-activity register remain unchanged in the [archive](ARCHIVE.md).
