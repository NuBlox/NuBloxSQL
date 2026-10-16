# Product definition — the authority

**Status:** Proprietary first-party native product scope accepted, 16 October 2026. The first PostgreSQL protocol v3 Driver/Shell workflow is experimental and defined in [TASK-001](TASK-001.md); no end-to-end released Driver/Shell/Workbench suite is qualified.
**Owner:** Stephen J T Spittal.
**Change control:** Record a deliberate decision in [DECISIONS.md](DECISIONS.md) before changing this definition. No other document may silently override it.

## What are we building?

**NuBloxSQL is a universal database driver foundation, accompanied by two professional tools, spanning the complete working life of databases.**

| Product | Deliverable | Responsible for | Must not do |
| --- | --- | --- | --- |
| NuBloxSQL Driver | Independently distributable headless library | Native database connectivity, capability negotiation, safe query/data operations, metadata, reusable DB-specific lifecycle primitives | Contain UI, Shell commands, arbitrary infrastructure administration, or claim unsupported engines |
| NuBloxSQL Shell | Independently distributable terminal tool | Interactive and scripted professional workflows; output and work products | Implement its own vendor protocol, SQL compiler or alternate driver |
| NuBloxSQL Workbench | Independently distributable graphical tool | Browser/desktop-oriented professional workflows, inspection, editing, guided tasks and evidence | Reimplement driver behaviour or import Shell internals |

The family supports **relational SQL and non-SQL data models**. A common kernel may expose connection lifecycle, identity, capabilities, errors, telemetry and cancellation. Engine-specific operations remain visible: SQL is not translated onto arbitrary document, graph, key-value or search systems just to manufacture “universality”.

## Why does it exist?

Database professionals repeatedly switch between vendor tools, connection conventions, scripting interfaces and inconsistent lifecycle procedures. NuBloxSQL aims to consolidate the **way people connect, discover, operate, change and document databases** without discarding native database fidelity. Its competitive advantage must be demonstrated by completed professional tasks, not interface breadth, vendor counts or generated source-file volume.

## Who is it for?

The [authoritative career taxonomy](CAREERS.md) establishes **six professional groups spanning 18 career families**: strategy/architecture/engineering; administration/operations; security/governance; data movement/analytics; specialist/non-relational technologies; and change/quality/innovation/consultancy. It preserves 240 job-title entries and 18 vendor/technology specialisations as *research inputs*.

Primary users are database administrators, architects, developers, platform/reliability engineers, operators, security specialists and migration specialists. Adjacent stakeholders include governance, analytics, AI, enterprise leadership and consultancy roles **where their tasks touch native database capabilities and evidence**. The career list expands the user research lens, not the Driver's scope into ERP, BI or ML training.

Careers are a **requirements-discovery lens**, not access rights. Authorisation is determined by authenticated identity, database privileges, approved action and environment controls.

## Where is it used?

On developers’ machines, operator workstations, servers, containers and automation hosts, accessing local/self-hosted databases and supported managed/cloud services. Private networks, TLS, tokens, IAM/Entra and proxy configuration need explicit, testable boundaries. NuBloxSQL does not provision entire cloud subscriptions, generic networks, Kubernetes clusters or operating systems.

## When is it used?

Across eleven canonical phases: **Select → Install → Initialize → Discover → Establish → Build → Use → Understand → Operate → Change → Retire**. “Complete lifecycle” is the product destination, not a statement that any phase currently has a working implementation.

## How will it work?

- A small and stable public Driver API delegates to **qualified native adapters**, each with explicit model/protocol, feature/version and deployment evidence.
- Every operation states capability prerequisites, security assumptions, output/work product and failure/rollback semantics.
- The Shell and Workbench use **only that public API** and independently prove an actual end-to-end professional outcome.
- A database technology catalogue, a native adapter contract, and cloud deployment/connectivity profiles are **separate**.
- Connection state, secrets and destructive privileges are tightly scoped. Long-running changes may require durable jobs, resumable state, approval and evidence; jobs do not replace product capabilities.
- The preferred implementation direction is **TypeScript on Node.js for the Driver/Shell and SvelteKit for Workbench**. These are design choices pending the reproducible toolchain gate, not evidence that software exists.

## Non-goals

An ERP, enterprise operating system, generic ETL platform, BI suite, cloud account provisioner, generic infrastructure-as-code platform, workforce system or “SQL translator for everything”. NuBloxSQL may integrate with such systems, but must not depend on them.

## What success looks like

A user can independently install each released product and complete an evidence-backed task with a real qualified database. Unsupported features are refused clearly. The Driver has documented public API stability; Shell and Workbench demonstrate the same database action without a second implementation. Every advertised vendor/cloud connection is backed by reproducible live tests and an explicit support matrix.

## Product status today

The **new main branch is a documentation-only specification**. The former code, tests, runtime coverage and v1 release line are archived, not silently declared qualified for the new design. Reuse is selective and requires acceptance tests before being reintroduced.
