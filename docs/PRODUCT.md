# Product definition — authoritative vision and boundaries

**Mission: NuBloxSQL aims to become the database technology platform of choice.**

**Active development mandate (17 October 2026): make the independently usable universal native NuBloxSQL Driver/client the flagship and immediate engineering priority.** The broader ecosystem remains strategic vision, but Shell, Workbench, ORM, visual tooling and future cross-vendor translation are **deferred**, not active reasons to divert native Driver development. "Most advanced" is an objective requiring comparative evidence, **not a current ranking**.

**Owner:** Stephen J T Spittal.
**Status:** Accepted long-term vision, 16 October 2026. This is a strategic destination **not** a statement of currently implemented or superior software.
**Authority:** Product scope lives here; decisions in [DECISIONS.md](DECISIONS.md) must record any deliberate change. Neither a specific feature, architecture diagram nor an experimental implementation may silently redefine the platform.

## What are we building?

**NuBloxSQL is a proprietary, ground-up, independently engineered, universal database technology platform.** It aims to offer the most comprehensive, coherent and effective database technologies and professional tools for developers, administrators, architects, engineers and other database professionals working across database vendors, data models, environments and the entire lifecycle.

**NuBloxSQL is larger than its Driver, Shell and Workbench.** They are major independently useful components, not a fixed three-product limit. ORM, query builders, development frameworks, design, migration, administration, automation and other database software capabilities also belong within the platform vision.

Becoming the **tool of choice** means earning users' preference with actual correctness, performance, security, native fidelity, professional usefulness and usability—not claiming market leadership without evidence.

## Why does it exist?

Today's database practitioners often combine competing vendor clients, native drivers, ORMs, query builders, query editors, data-modelling tools, migration frameworks, database consoles, monitoring products and scripts. Their features, terminology, access controls and outputs are inconsistent, and vendor differences increase training and maintenance costs.

NuBloxSQL aims to integrate the strongest capabilities from these categories into one coherent independently developed technology ecosystem, **without destroying the unique capabilities of each database**.

## Who, where and when?

- **Who:** Application developers, database developers, DBAs, administrators, designers, engineers, architects, operators, reliability and security practitioners, testing specialists, integration specialists and the 18 database career families described in [CAREERS.md](CAREERS.md). Roles are research lenses, never automatic privileges.
- **Where:** Developer machines, servers, containers, embedded/local deployments, on-premises and networked systems, distributed infrastructure and supported managed/cloud database services. Actual security, networking and vendor combinations need qualification.
- **When:** Throughout the canonical eleven-phase lifecycle: **Select → Install → Initialize → Discover → Establish → Build → Use → Understand → Operate → Change → Retire**. Each activity must have clear outcomes and work products.

## Platform capability families

These are strategic coverage areas, **not** currently qualified features, commitments to a particular package topology or an exhaustive inventory of every product in the market.

| Family | Capabilities NuBloxSQL aims to provide |
| --- | --- |
| **First-party native connectivity** | NuBloxSQL-owned database protocols and native adapters, connection/session lifecycle, authentication, verified TLS, native data types, binding, transactions, metadata, capabilities, errors, pooling and resource control |
| **Query technologies** | Composable, type-safe, model- and vendor-aware query builders; SQL/dialect parsing, compilation, validation, analysis, query plans, profiling and optimisation tooling |
| **ORM and data mapping** | Relational ORM with entities, relationships, persistence, mapping, change tracking and schema generation; separately model-native abstractions for document, graph, key-value and other systems where appropriate |
| **Database design and development** | Data modelling, logical/physical schema design, editors, object browsers, reverse engineering, code generation, debugging, testing and impact analysis |
| **Schema change and delivery** | Schema comparison, migrations, change review, rollback, drift detection, version control integration and repeatable deployment |
| **Administration and operations** | Technology selection, installation, initial configuration, users/privileges, diagnostics, monitoring, tuning, capacity, availability, maintenance, backup, restore, incident response and retirement |
| **Data operations** | Secure browsing/editing, import/export, comparison, controlled migration, copying, transformation, integration and lineage evidence |
| **Security and governance** | Least privilege, credential and secret policy, auditing, access assessment, reviewable evidence, compliance-related database operations and reliability safeguards |
| **Automation and professional tooling** | SDKs and developer frameworks, NuBloxSQL Shell, NuBloxSQL Workbench, batch/scheduled/durable operations, workflows, approvals, recovery and role-relevant work products |
| **Cross-vendor interoperability (future)** | Express supported capabilities and operations across database vendors in familiar terminology, including a possible MySQL-oriented experience over PostgreSQL capabilities, where semantics genuinely permit |

This is a **living capability research scope**, not a synthetic list of release promises. NuBloxSQL should learn from all credible existing database tool categories and strive to build something substantially better.

### Foundational products and independent developer technologies

- **NuBloxSQL Driver:** the first-party programmable native database connectivity/execution foundation, supporting vendor-specific fidelity and a deliberate portable surface where semantics align.
- **NuBloxSQL Shell:** a comprehensive command-line and scripting application for database work throughout the lifecycle, built on public platform APIs rather than private vendor implementations.
- **NuBloxSQL Workbench:** an accessible, comprehensive graphical professional database environment built on the same public capabilities.
- **ORM, query builder and other developer technologies:** independently consumable platform capabilities. Applications must not be required to install Shell or Workbench to use them.

Other independently useful products or libraries may emerge from real requirements. Do **not** restrict the platform to three modules, create speculative empty packages, or require everything to live in the Driver.

## How should the technology behave?

1. **Ground-up proprietary engineering:** first-party native vendor protocol/driver implementations, typed public APIs and NuBloxSQL-owned product behaviour. General-purpose programming languages, operating systems, Node networking/TLS/crypto and legitimate build tools remain permissible. Do not wrap existing third-party database drivers while marketing them as native NuBloxSQL.
2. **Native fidelity before artificial uniformity:** preserve dialects, database data models, transactions, type systems, deployment and native administrative semantics. A shared API may unify proven common behaviour, while native capability APIs remain available and explicit.
3. **Composable, independent usage:** Driver, ORM, query builder, metadata, migrations, SDKs and other developer capabilities should be usable without either professional UI. Shell/Workbench are consumers of shared services, not the owners of database protocols.
4. **Real professional outcomes:** derive work from database career activities, lifecycle tasks and measurable work products; test native operations and results against real qualified engines.
5. **Secure, dependable and supportable:** verify host identity/TLS, honour privileges, handle secrets safely, bound work, support cancellation and cleanup, provide dependable diagnostics, rollback and audit where appropriate.
6. **Vendor- and model-aware interoperability:** a MySQL user might eventually interact with PostgreSQL capabilities using familiar MySQL terms. Translation of terminology or SQL syntax must be distinguished from actual equivalent semantics, deliberate emulation or unimplementable features. Explicitly disclose any semantic changes, unsupported functions or loss.

## What makes NuBloxSQL the tool of choice?

This is a **measurable objective**, not a currently established fact. Evaluate against leading tools on like-for-like tasks using reproducible evidence for correctness, protocol/native depth, performance, memory, portability, security, reliability, accessibility, documentation, productivity, feature coverage and quality of completed professional work.

Do not assume we will immediately exceed every specialist incumbent in every category. Benchmark relevant capabilities honestly and improve until users can independently demonstrate a reason to choose NuBloxSQL.

## Boundaries and non-goals

- **Not only a Driver, Shell and Workbench:** these do not define the full product limits.
- **Not generic SQL pasted onto every database:** SQL and non-SQL native models remain distinct, and cross-vendor translation is a **long-term** goal, not current engine magic.
- **Not automatically a NuBloxSQL database server/storage engine:** building a new DBMS is not presently an accepted requirement; it would need explicit separate scope and proof.
- **Not an unrelated ERP, BI, AI training or infrastructure platform:** NuBloxSQL remains **database technology first**, while integrating with other tools and cloud providers through explicit contracts.
- **Not universal vendor support today:** catalogued engines are not qualified implementations. Every advertised engine/version/auth/TLS/cloud/capability combination requires evidence.

## First-priority native Driver requirements

NuBloxSQL Driver must become a coherent multi-vendor, multi-model native client. Its primary responsibilities are protocol and embedded connectivity, encryption/authentication, resource lifecycle, secure parameter binding, native data-type fidelity, transactions, cancellation, streaming/pooling, structured errors, native metadata and truthful capability negotiation. Local, remote, distributed, cloud-managed and cloud-native endpoints require distinct verified identity/network qualifications.

Shared operations may be portable only when database semantics truly match; relational SQL must never be silently forced onto document, graph or key-value interfaces. Native vendor capabilities must remain accessible instead of being flattened to a lowest common denominator. Real-instance conformance, performance and security benchmarks determine the maturity of each vendor/version/feature combination.

**The Driver must be independently consumable.** It must not depend on Shell, Workbench, ORM or other NuBlox products. The current two-engine SQL client is an architecture proof, not universality, full feature parity or a production release.

## Delivery discipline and current status

The [TASK-001](TASK-001.md) PostgreSQL inventory is **one first engineering demonstration**, not the market definition or upper limit of NuBloxSQL. The [ROADMAP.md](ROADMAP.md) sequences risk-controlled proof points towards this broader goal. The [REQUIREMENTS.md](REQUIREMENTS.md) owns traceable feature requirements; the [ARCHITECTURE.md](ARCHITECTURE.md) owns implementation boundaries; [SUPPORT-AND-QUALIFICATION.md](SUPPORT-AND-QUALIFICATION.md) owns verified release claims.

As of 16 October 2026, `main` has an experimental private first-party PostgreSQL 17 protocol v3/SCRAM read-only inventory Driver and a Shell using its public API, exercised by narrow live tests. **The ORM, query builder, complete Workbench, universal coverage and cross-vendor translation are not yet implemented or qualified.** Former implementation assets remain in the [legacy archive](ARCHIVE.md). Published npm v1 artefacts are historical and must not be overwritten by reboot builds.
