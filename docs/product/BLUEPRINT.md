# NuBloxSQL Product Blueprint

This is the **single authoritative product blueprint** for NuBloxSQL.

It defines what NuBloxSQL is, what it is not, how the product is decomposed, how the database lifecycle is interpreted, how cross-cutting execution infrastructure fits, and the order in which the product should be developed.

If another roadmap, architecture note, capability document, implementation discussion, or future proposal conflicts with this blueprint, **this blueprint wins until deliberately revised in the repository**.

## Product promise

> **NuBloxSQL is a universal SQL driver — one JavaScript/TypeScript API for native SQL, database connectivity and headless lifecycle capabilities, with honest engine-specific semantics.**

Governing design rule:

> **One developer API, honest dialect semantics.**

NuBloxSQL exists to give application developers, database engineers, DBAs, platform teams, tooling developers and automation systems one programmable driver foundation without flattening PostgreSQL, MySQL, SQLite and SQL Server into a false lowest-common-denominator abstraction.

**The product family comprises three separate products:**

- **NuBloxSQL Driver** (`nubloxsql`) — universal SQL connectivity, dialect semantics, SQL execution, metadata and reusable headless database lifecycle capabilities.
- **NuBloxSQL Shell** (`apps/shell/`) — terminal and automation tools for professional database tasks through the public driver API.
- **NuBloxSQL Workbench** (`apps/workbench/`) — graphical tools for the same professional tasks through the public driver API.

The driver's architecture aims at universal SQL coverage, **not** a claim that every DBMS or lifecycle capability is already supported. Shell and Workbench are independently useful **tools**, not runtime engines, DBMS adapters or drivers. See [Product Surfaces](PRODUCT-SURFACES.md) and the [profession work register](database-profession-work-register.json).

## Supported runtime engines

The current executable product focus is deliberately limited to:

- PostgreSQL;
- MySQL;
- SQLite;
- SQL Server.

The broader dialect/profile registry is knowledge and future-expansion infrastructure. Registry presence does not imply runtime support.

A database family/version becomes supported only when implementation, semantics, qualification and release evidence exist.

## Three independent dimensions

NuBloxSQL is easier to reason about when three concepts are kept separate.

### 1. Product domains — what NuBloxSQL does

The product has eight functional domains.

#### Engine lifecycle and installation

Owns database-engine/runtime lifecycle concerns before and around normal connectivity:

- engine/version/edition/distribution selection evidence;
- target inspection;
- prerequisite assessment;
- installation source/media modelling;
- installation providers;
- installation planning/execution/verification;
- cluster/instance/data-directory/file initialization;
- repair/reconfiguration boundaries;
- engine upgrade planning/execution;
- decommission and uninstall.

#### Connectivity and runtime

Owns:

- native connections and pools;
- authentication and TLS;
- connection URLs/configuration;
- prepared statements;
- parameter binding;
- transactions/savepoints;
- streaming;
- cancellation/deadlines;
- native protocols;
- errors/retry semantics;
- observability;
- runtime resource governance.

#### SQL language

Owns:

- tokenization;
- parsing;
- AST;
- semantic validation;
- capability-aware compilation;
- rendering;
- rewrite/transpilation;
- DQL/DML/DDL/TCL/DCL/administration/procedural language families according to product priority.

#### Database intelligence

Owns:

- server/version discovery;
- metadata and introspection;
- canonical object identity;
- structure trees;
- dependencies/impact;
- query plans;
- diagnostics;
- statistics;
- capability discovery;
- configuration/limits discovery;
- drift and compatibility evidence.

#### Database engineering

Owns:

- canonical type semantics;
- schema snapshots;
- schema diff;
- migration planning/execution;
- data movement;
- transformation/validation;
- compatibility assessment;
- import/export engineering primitives.

#### Database administration

Owns the managed database runtime after initialization:

- database/catalog creation;
- schema/namespace bootstrap;
- users/logins/roles;
- privileges;
- database/server configuration;
- extensions/features;
- storage/database options;
- administration APIs;
- database-owned operational baselines.

#### Database operations

Owns:

- health;
- sessions/running work;
- locks/blocking/deadlocks;
- performance diagnostics;
- maintenance;
- integrity;
- backup;
- restore/recovery;
- capacity/storage;
- replication/high availability;
- audit;
- upgrade readiness.

#### Portability and governance

Owns:

- dialect/DBMS registry;
- capability ontology;
- version differences;
- profile overlays;
- portability decisions;
- compatibility warnings;
- risk/policy classification;
- qualification/evidence state.

### 2. Lifecycle phases — when and why capabilities are used

The canonical database lifecycle is:

```text
Select
  → Install
    → Initialize
      → Discover
        → Establish
          → Build
            → Use
              → Understand
                → Operate
                  → Change
                    → Retire
```

Lifecycle phases are **not product folders** and should not be confused with domains.

The same domain may serve several phases. For example, Database Intelligence supports Discover, Understand, Operate, Change and Retire.

The detailed lifecycle model is defined in [Database Lifecycle](../architecture/DATABASE-LIFECYCLE.md).

### 3. Execution level — how work is carried out

Execution has three levels:

- **Operation** — bounded work in the current request/session/process.
- **Job** — durable work with identity, state, checkpoints, policy and audit.
- **Workflow** — dependency graph coordinating multiple jobs and gates.

Jobs are a **cross-cutting execution substrate**, not a ninth lifecycle phase and not a replacement for the product domains.

The detailed model is defined in [Database Jobs](../architecture/DATABASE-JOBS.md).

## Three product surfaces

The eight driver capability domains stay independent of interfaces. The
[product surface model](product-surface-model.json) records the machine-readable
driver/tool relationship.

### NuBloxSQL Driver — public JavaScript/TypeScript API

The `nubloxsql` npm package is the universal SQL **driver** and shared
headless foundation. It owns native database protocols, SQL/dialect behavior,
execution, schema intelligence and qualified reusable lifecycle operations.
The driver must not import Shell or Workbench or implement their user journeys.

### NuBloxSQL Shell — professional terminal product

The existing `apps/shell/` app consumes the **public driver API** to provide
interactive database work, repeatable commands, automation and evidence
outputs. It must not fork engine or compiler logic.
See [Shell Architecture](../architecture/SHELL.md).

### NuBloxSQL Workbench — professional graphical product

The existing `apps/workbench/` local graphical preview consumes the
**same public driver API**. It is the graphical sibling of Shell, with
database exploration, SQL authoring and an intended set of guided lifecycle
workflows. It is not a completed, independently released Workbench suite.

### Profession-led requirements

The [profession work register](database-profession-work-register.json)
provides a curated **18-family, 40-activity** requirements input. For each
activity, identify governance/delivery responsibility, lifecycle phase,
expected work product, underlying driver capability, and terminal/graphical
workflow. **Career title is not authorization.** The register is not
an employment, workforce management, DBMS role or grants model.

Driver, Shell and Workbench are **three separate deliverables**, each
requiring its own acceptance and release evidence. Not every increment must
ship three finished products, but end-to-end usable professional tasks are
the goal; isolated APIs and buttons are not sufficient.

## Core terminology

### Dialect

A NuBloxSQL semantic/runtime support model for a database family.

A dialect is software inside NuBloxSQL. It is **not** what gets installed on a host.

### Engine/runtime

Installable or embeddable database software such as PostgreSQL server, MySQL Server, SQL Server Database Engine or SQLite runtime/library.

### Managed resource

A concrete cluster, instance, database, schema or SQLite file managed through the lifecycle.

### Provider

An explicit boundary through which NuBloxSQL performs environment-specific actions.

Providers do not grant arbitrary remote-shell authority. They execute constrained lifecycle actions defined by NuBloxSQL contracts.

## Infrastructure boundary

NuBloxSQL owns **database-specific lifecycle intent, planning, execution semantics, verification and evidence**.

NuBloxSQL may own:

- database-engine selection evidence;
- database-specific installation prerequisites;
- installation plans/provider calls;
- cluster/instance/data-directory/file initialization;
- database-service readiness when provider-owned;
- database bootstrap;
- database configuration;
- database security administration;
- database maintenance;
- backup/recovery integration;
- replication/HA visibility;
- engine upgrade planning;
- database retirement;
- engine/runtime decommission.

NuBloxSQL does **not** become:

- a cloud account/subscription provisioner;
- a generic VM provisioner;
- a VPC/VNET manager;
- a general firewall manager;
- a Kubernetes cluster manager;
- corporate DNS administration;
- arbitrary operating-system management;
- generic infrastructure-as-code;
- a general remote-shell orchestrator;
- a generic CI/CD/workflow platform.

Infrastructure tools may provide environments or act as execution providers. NuBloxSQL remains responsible for database intent and database-native correctness at that boundary.

## Native-depth rule

Portable intent is valuable only where semantics are genuinely comparable.

Engine-specific behaviour must remain visible.

Examples:

- PostgreSQL bulk movement may use COPY;
- MySQL may use controlled LOCAL INFILE;
- SQL Server may use TDS bulk mechanisms;
- SQLite may use prepared transactional batching.

The same rule applies to installation, security, backup, restore, maintenance, configuration, scheduling, replication and upgrade.

A common API may describe common intent. Execution must remain honest about native differences.

## Support and evidence states

Every capability should distinguish evidence maturity rather than relying on branding.

Recommended states include:

- known/profiled;
- documented;
- partially implemented;
- implemented;
- contract-tested;
- live-qualified;
- packaged/public;
- unsupported.

No feature is considered released solely because a dialect registry says an engine has a similarly named feature.

## Non-goals

NuBloxSQL is not:

- an ORM;
- an object model;
- an ERP;
- a business application platform;
- a database engine;
- a workbench UI;
- a lowest-common-denominator abstraction;
- a generic OS/package manager;
- a generic cloud/IaC product;
- a requirement to implement every DBMS known to the registry.

## Product architecture

At the highest level:

```text
Database professions → activities → expected work products
                             │
                 ┌───────────┴────────────┐
                 ▼                        ▼
          NuBloxSQL Shell          NuBloxSQL Workbench
        Terminal / automation      Graphical professional tool
                 │                        │
                 └───────────┬────────────┘
                             ▼
                     NuBloxSQL DRIVER
                       Public JS/TS API
                             │
           Immediate operations / jobs / workflows
                             │
                             ▼
Eight driver capability domains
├── Engine lifecycle & installation
├── Connectivity & runtime
├── SQL language
├── Database intelligence
├── Database engineering
├── Database administration
├── Database operations
└── Portability & governance
        │
        ▼
Engine implementations
├── PostgreSQL
├── MySQL
├── SQLite
└── SQL Server
```

## Fixed development sequence

The product should no longer be reprioritized casually whenever a new adjacent capability is discovered.

New discoveries are added to the capability map and scheduled according to dependencies.

The frozen high-level sequence is:

### Foundation

1. Product architecture and capability map.
2. Dialect/capability model.
3. Runtime/connectivity foundations.
4. Durable job kernel.

### Complete database lifecycle foundations

5. Engine lifecycle.
6. Database administration.
7. Security administration.
8. Operational health and maintenance.
9. Backup/restore/recovery.
10. Replication/HA/capacity.
11. Upgrade execution.
12. Retirement/decommission.

### Engineering and language depth

13. Remaining SQL language completeness.
14. Metadata/intelligence depth.
15. Schema engineering/migration depth.
16. Data movement/import/export depth.

### Professional tools

17. Extend NuBloxSQL Shell with usable professional work-product flows built on qualified driver capabilities.
18. Extend the **existing** NuBloxSQL Workbench preview with graphical workflows built on the **same** public driver contracts.

Existing capabilities that are already ahead of this sequence are retained. They are not rebuilt merely to match the ordering.

## Current strategic priority

The current cross-cutting priority is the **Durable Job execution substrate**. The internal job kernel and same-host durable SQLite JobStore now exist; the internal worker execution loop now exists; read-only server-discovery and host-inspection job adapters now reuse qualified domain APIs. The internal approval classifier, durable approval and cancellation records, bounded read-only retries and opt-in replay-safe recovery now exist. Explicit approval policy, controlled verification and target-side fencing must still be qualified against real mutation adapters before they can be enabled, followed by scheduling. Existing executors need shared:

- durable identity;
- checkpoints;
- retry;
- cancellation;
- leasing/locks;
- scheduling;
- audit;
- workflow orchestration.

Existing executors should become adapters into that substrate rather than each growing their own orchestration system.

The implementation sequence for jobs is maintained in [Database Jobs](../architecture/DATABASE-JOBS.md).

## Product decision gate

Before a new feature enters implementation, answer:

1. Which professional activity ID and work product does it deliver?
2. Which product domain owns it?
3. Which lifecycle phases use it?
4. Is it an operation, job or workflow concern?
5. Is it database lifecycle management or merely useful to a downstream product?
6. Can common intent be expressed without hiding engine differences?
7. What native behaviour must remain visible?
8. What safety/failure boundary applies?
9. What evidence will prove it?
10. What existing dependency must be complete first?
11. Does it preserve NuBloxSQL as a standalone product?
12. Does it outrank the currently frozen roadmap item?

If those questions do not justify the work, the feature does not interrupt the roadmap.

## Source-of-truth hierarchy

Use this order when repository material disagrees:

1. this Product Blueprint;
2. machine-readable release contracts under `docs/releases/`;
3. current public API/types and implementation;
4. Product Capability Register;
5. Product Roadmap;
6. detailed architecture documents;
7. user guides/cookbook;
8. Git history and prior release commits.

Historical repository states never override current product contracts.

## Definition of done for a subsystem

A subsystem is not complete until, where applicable:

- public contract exists;
- native semantics are explicit;
- validation fails closed;
- safety/risk boundaries are represented;
- contract tests exist;
- live qualification exists for supported engines when real execution is claimed;
- TypeScript declarations match runtime;
- package/release surface includes it;
- user documentation exists;
- Product Coverage evidence is updated;
- repository qualification passes.

## Product promise

A developer or database engineer should be able to begin with engine selection and continue using the same platform through:

> **Select. Install. Initialize. Discover. Establish. Build. Use. Understand. Operate. Change. Retire.**

The goal is not simply broad SQL syntax support.

The goal is a trustworthy universal SQL **driver** and two distinct professional tools — Shell and Workbench — enabling database work across the complete lifecycle.
