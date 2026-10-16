# Users, lifecycle and outcomes

The core planning unit is a **professional task with a demonstrable work product**, not a job title or a screen.

## Who does the work?

- **Governance:** database technology strategy, standards, architecture, permissions policy, support qualification, change approval, risk and evidence review.
- **Delivery:** database setup, querying, schema engineering, diagnostics, monitoring, repair, migration, recovery, decommissioning and validation.
- Real people may do work in both groups. A role or career label never confers access rights.

The active [career taxonomy](CAREERS.md) contains **6 professional groups, 18 career families, 240 title entries (239 distinct titles), and 18 vendor/technology specialisations**. It is an explicitly user-provided reference input, not an authorisation or software-capability model. The [active work register](WORK-REGISTER.md) records **64 unreviewed candidate activities** (40 traceable to the archive plus 24 explicit gap candidates), each linked to career families, lifecycle phases, work products and evidence criteria. Review their scope and acceptance before promoting any to implemented requirements.

## Eleven phases with minimum evidence outcomes

| Phase | Professional outcome | Example work product |
| --- | --- | --- |
| 01 Select | Choose an appropriate engine, edition, version and deployment | Qualified options/decision record |
| 02 Install | Assess prerequisites and install a chosen engine through an authorised provider | Installation evidence and prerequisite report |
| 03 Initialize | Initialize database resources and verify readiness | First-run/initialisation record |
| 04 Discover | Inspect engine identity, databases, schema and capabilities | Versioned database inventory |
| 05 Establish | Set up secure, configured database access and operational baseline | Configuration and privilege baseline |
| 06 Build | Create and validate database structures using native semantics | Schema/DDL changes and validation |
| 07 Use | Run bounded native operations, transactions and data movement | Query or transfer result and audit evidence |
| 08 Understand | Diagnose queries, schemas, dependencies and performance | Explain/impact/diagnostic report |
| 09 Operate | Maintain, secure, monitor, back up and restore a database | Health, backup and restore-verification records |
| 10 Change | Plan, approve, execute, verify and recover from migrations/upgrades | Change plan, checkpoints and outcome |
| 11 Retire | Retire data and decommission an engine safely | Disposal, retention and completion evidence |

## Traceability contract

For each task, define **task ID → user outcome → lifecycle phase → governance/delivery responsibility → native driver capability → required privileges/policy → Shell command → Workbench journey → generated evidence → acceptance test**.

Example candidate: **TASK-001: inspect a running PostgreSQL instance**.
- Input: authorised connection profile and read-only discovery rights.
- Output: database identity, server version, capabilities and inventory in a structured file.
- Driver: connection + native discovery; Shell: `inspect`; Workbench: connection explorer.
- Acceptance: independently run the same task on a real supported instance, compare evidence, refuse unsupported fields rather than fabricate them.

## Execution scale

An **operation** is bounded work, a **job** is durable work with identity/retry/checkpoint/evidence, and a **workflow** coordinates multiple jobs with approvals or dependencies. These are execution mechanisms; they are not extra lifecycle phases.

The initial curated requirements backlog is [REQUIREMENTS.md](REQUIREMENTS.md). No requirement is implemented just because it appears here.
