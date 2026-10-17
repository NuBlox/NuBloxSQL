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
| ADR-011 | Specify TASK-001 with one common Driver/Shell/Workbench database inventory work-product contract | Establish a concrete vertical integration acceptance target before implementing packages |
| ADR-012 | Accept TASK-001's PostgreSQL 17 discovery contract, safe error/schema examples, native CONNECT visibility filter, Node 24/strict TS/ESM/npm workspaces and independent SvelteKit Workbench server | Close G0 for a bounded, testable vertical slice. The `pg` transport was a temporary prototype only; ADR-014 supersedes it with first-party protocol implementation. All release support remains unqualified. |
| ADR-013 | Implement the first private experimental Driver and Shell packages for TASK-001 with actual PostgreSQL catalog reads, safe output and live CI | Validate an end-to-end partial slice before introducing SvelteKit Workbench; neither runtime nor public release is qualified until G1/G2/G3 evidence exists |
| ADR-014 | NuBloxSQL is proprietary, independently developed **native database software**, not a thin wrapper over third-party vendor/client drivers | Own protocol framing, native authentication and session semantics, query binding, capability negotiation, metadata/runtime abstraction and vendor adapter source. Node core socket/TLS/crypto primitives and build-time tooling may be used; third-party DBMS client/driver libraries may not be runtime requirements of first-party adapters. |
| ADR-015 | Replace the initial experimental `pg` reference transport with first-party PostgreSQL 3.0 code, beginning with bounded SCRAM over local loopback | Preserve existing Driver/Shell result contracts and real-engine tests; reject remote TLS until the first-party native implementation proves correct SSLRequest and peer verification. Scope the initial code to one native read-only inventory, not a full SQL driver release. |
| ADR-016 | NuBloxSQL's mission is to become **the database technology platform of choice**: a comprehensive proprietary database technology ecosystem, not only Driver, Shell and Workbench | User-confirmed product direction includes ORM, query builder and all relevant database-tool categories, advanced professional lifecycle tooling and measurable superiority, while independently validating capabilities |
| ADR-017 | Treat future cross-vendor terminology/capability interoperability as a strategic capability distinct from native connectivity | A MySQL-oriented user may eventually access PostgreSQL capabilities through familiar concepts when semantically valid; disclose lossy, emulated and unsupported operations rather than promise magical equivalence |
| ADR-018 | Keep narrow Driver/Shell/Workbench integrations as engineering proof points, not a definition of full product scope | Avoid repeated project drift; developer SDKs, ORM, query builder, design, migration and other professional tools can become independent platform products without a fixed product-count limit |
| ADR-019 | Require evidence-led reuse assessment of the immutable NuBloxSQL archive **before** rewriting native driver, query, schema or lifecycle assets | Existing 635-file historical source contains substantial first-party PostgreSQL/MySQL/TDS/RESP and query/migration code. Review provenance, source dependencies and current/live qualification before selective reuse. Never bulk restore or treat MongoDB's third-party-driver wrapper as first-party |
| ADR-020 | Consolidate archive-inspired PostgreSQL result budgets and operation deadlines inside the **existing** private native client without a new driver or wrapper | A startup timer must not expire healthy sessions; errors must invalidate unconsumed-protocol sessions; enforce row/byte budgets and one active query. Use a fatal disconnect on timeout until archive CancelRequest and recovery can be separately qualified on real PostgreSQL |
| ADR-021 | Implement first-party PostgreSQL SSLRequest and mandatory TLS chain/target-name verification without fallback; consume archived NuBloxSQL transport-policy concepts rather than importing vendor DB clients | Independent real PostgreSQL 17 CA/certificate positive, unknown-CA, valid CA/wrong-name and refusal tests protect the Driver and Shell. Direct cleartext remains confined to isolated loopback. No vendor cloud/IAM, channel-binding or production support claim follows from fixture tests. |
| ADR-022 | Organise the **implemented** repository by package/application, native adapter, reusable operation and test level, with enforced dependency boundaries | Keep private vendor transport and catalogue SQL at `packages/driver/src/adapters/<vendor>/`, shared operations at `packages/driver/src/operations/`, the public API at `src/index.ts`, independent Shell at `apps/shell/` and unit/integration/fixture tests separated. Do not create placeholder ORM/query-builder/Workbench packages until their real public contracts exist; preserve all qualified outcomes and the archive. |

## Proposed decisions requiring specification review

| ID | Proposal | What must be decided |
| --- | --- | --- |
| ADR-P05 | Initially use simple operation execution; add durable jobs when required | Checkpointing, approval, audit and target-fencing criteria |
| ADR-P06 | Separate public reusable database APIs from environment provider APIs | Remote installation/cloud identity and destructive action contracts |

## Change-control procedure

1. Describe the user problem and the trade-off. Link requirements and professional tasks.
2. List alternatives and their impact on native fidelity, security, package distribution and maintenance.
3. Choose one option; move its proposal into the accepted table with evidence and date.
4. Update affected authoritative documents in the same PR.
5. Add verification criteria before source code.

**GitHub protection (16 October 2026):** the repository owner installed both [main ruleset #25231727](https://github.com/NuBlox/NuBloxSQL/rules/25231727) and [archive ruleset #25231728](https://github.com/NuBlox/NuBloxSQL/rules/25231728); live API reports both `active` and both branches protected, with no bypass actors. The [installer verifier](admin/README.md) was corrected for GitHub's omission of default-false update parameters. Re-run it on the Mac for complete effective-rule endpoint confirmation and use [the guarded main policy upgrade](admin/README.md) to add the new `Node 24 — Driver and Shell` required CI check after PR #339; see [issue #328](https://github.com/NuBlox/NuBloxSQL/issues/328).
