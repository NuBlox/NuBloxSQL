# Decision log and open questions

This is the only decision log. “Proposed” means review is still required; it is not a concealed implementation promise.

## Accepted baseline decisions

| ID | Decision | Reason |
| --- | --- | --- |
| ADR-001 | Keep NuBloxSQL as the product family name | Maintain brand/repository identity |
| ADR-002 | Preserve the complete v1 implementation on archive/legacy-implementation-2026-10-16 | Recoverability without inheriting legacy structure |
| ADR-003 | Restart main as documentation-only; do not publish from it | Restore clarity, avoid accidental incompatible v1 publication |
| ADR-004 | Define three independent deliverables: Driver, Shell, Workbench | Enforce product ownership and API boundaries |
| ADR-005 | Target native SQL and non-SQL database models, with cloud as a separate deployment dimension | Universal ambition without dishonest compatibility |
| ADR-006 | Make native vendor support a qualified evidence claim, never a registry-count claim | Testable and trustworthy product |
| ADR-007 | Define product scope and lifecycle tasks before implementing more code | Prevent repetition and speculative architecture |
| ADR-008 | Preserve the proprietary licence and ownership notice | Avoid unintentional relicensing |
| ADR-009 | Use one career taxonomy data file for the 6 groups, 18 families, 240 role entries and 18 technology examples | Preserve the user-supplied research dataset without equating titles to permissions, features or supported vendors; tasks stay authoritative in WORK-REGISTER.md |
| ADR-010 | Catalogue 40 archived and 24 gap candidate activities with explicit work products and independent acceptance evidence | Make gaps reviewable without treating research input as delivered functionality; keep WORK-REGISTER.md and its one JSON dataset authoritative |

## Proposed decisions requiring specification review

| ID | Proposal | What must be decided |
| --- | --- | --- |
| ADR-P01 | TypeScript + Node.js for headless Driver/Shell | Module format, package manager, release targets, minimal supported Node |
| ADR-P02 | SvelteKit for Workbench | Web/server/local deployment and privilege boundary |
| ADR-P03 | PostgreSQL first vertical slice (TASK-001) | Version(s), fixture, required capabilities and acceptance contract |
| ADR-P04 | Split packages into Driver, native adapters and independent apps | Precise package topology, plugin/runtime dependency policy |
| ADR-P05 | Initially use simple operation execution; add durable jobs when required | Checkpointing, approval, audit and target-fencing criteria |
| ADR-P06 | Separate public reusable database APIs from environment provider APIs | Remote installation/cloud identity and destructive action contracts |

## Change-control procedure

1. Describe the user problem and the trade-off. Link requirements and professional tasks.
2. List alternatives and their impact on native fidelity, security, package distribution and maintenance.
3. Choose one option; move its proposal into the accepted table with evidence and date.
4. Update affected authoritative documents in the same PR.
5. Add verification criteria before source code.

**Outstanding GitHub administration:** default branch has no enforced ruleset and the new archive ref is not administratively protected. The repository owner must configure both; see [issue #328](https://github.com/NuBlox/NuBloxSQL/issues/328). This is not fixed by writing documentation.
