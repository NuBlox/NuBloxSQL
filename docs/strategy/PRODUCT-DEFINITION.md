# NuBloxSQL Product Definition

This document is the canonical product boundary and planning authority for NuBloxSQL.

If a proposed feature, roadmap item, design discussion or implementation conflicts with this document, this document wins until it is deliberately revised in the repository.

## Product in one sentence

> **NuBloxSQL is a comprehensive JavaScript and TypeScript database engineering and management platform that provides one coherent API across the complete SQL database lifecycle—from engine selection, installation and initialization through discovery, development, operation, upgrade, recovery and retirement—while preserving the native semantics of every supported database engine.**

Short form:

> **NuBloxSQL — one API for the complete SQL database lifecycle.**

Governing design rule:

> **One developer API, honest dialect semantics.**

## Why NuBloxSQL exists

Database work is fragmented across drivers, query builders, administration scripts, schema tools, migration systems, diagnostic utilities, backup tooling and vendor-specific interfaces.

A developer or database engineer working across several SQL engines commonly has to assemble and reconcile different libraries and operational conventions for:

- connectivity and pooling;
- SQL execution;
- transactions;
- metadata;
- schema discovery;
- diagnostics;
- migrations;
- data movement;
- security administration;
- maintenance;
- backup and recovery;
- replication and high availability;
- capacity and health monitoring.

Many portability layers solve this by hiding engine differences. NuBloxSQL must not.

NuBloxSQL exists to provide a coherent programmable database platform while retaining the real semantics, capabilities, restrictions and native mechanisms of each supported engine.

## Who it is for

Primary users are:

1. **Application developers** building Node.js and TypeScript applications.
2. **Database engineers and DBAs** who need programmable administration, diagnostics and lifecycle control.
3. **Platform and tooling developers** building database IDEs, workbenches, developer tools, CI/CD systems and internal platforms.
4. **DevOps and data/platform teams** automating database setup, change, movement, maintenance and recovery.

NuBloxSQL is infrastructure. Applications and products may be built on top of it, but NuBloxSQL must not depend on those downstream products.

## Where it runs

NuBloxSQL is intended for:

- Node.js services;
- TypeScript/JavaScript backends;
- command-line tools;
- CI/CD pipelines;
- database administration tooling;
- developer tooling;
- data engineering utilities;
- automation workers;
- future database workbench/IDE products.

The package is server-side infrastructure. It is not a browser database-management UI.

## Supported engines

The current executable product focus is:

- PostgreSQL;
- MySQL;
- SQLite;
- SQL Server.

Other DBMS and dialect profiles may exist in the knowledge registry, but registry presence is not runtime support.

A database/profile becomes supported only after the relevant driver, semantics, qualification and release evidence exist.

## Complete lifecycle

NuBloxSQL owns the database-specific lifecycle from **engine/runtime selection and installation through final retirement and decommissioning**.

The canonical lifecycle is:

```text
Select
  -> Install
     -> Initialize
        -> Discover
           -> Establish
              -> Build
                 -> Use
                    -> Understand
                       -> Operate
                          -> Change
                             -> Retire
```

The phases are ordered for planning, but mature systems continuously loop through Understand, Operate and Change.

### Phase 1 — Select

Choose the engine, dialect, target version, edition/distribution, platform compatibility, installation strategy, required components and support horizon. Produce explicit compatibility evidence rather than assuming that a known dialect is deployable on a target environment.

### Phase 2 — Install

Acquire and install the database engine/runtime using an explicit installation provider. NuBloxSQL owns database-specific installation intent, prerequisites, planning, safety classification, verification and audit. Host mutation occurs only through an explicit provider or manual plan.

### Phase 3 — Initialize

Turn installed software into a viable database runtime: initialize PostgreSQL clusters or MySQL data directories, configure SQL Server instances, create/open SQLite files, establish initial administrative identity, start/readiness state and first-run database-owned settings.

### Phase 4 — Discover

Understand an initialized or existing environment before changing it:

- detect engine, version, edition/distribution and instance/cluster identity;
- inspect connectivity and TLS;
- discover databases/catalogs;
- inspect server/instance configuration;
- inspect installed capabilities/extensions/components;
- inspect topology;
- inspect storage and limits where available;
- establish health and compatibility baseline.

### Phase 5 — Establish

Bring the discovered runtime into a usable operational baseline:

- validate prerequisites;
- create databases/catalogs where the engine permits;
- create schemas/namespaces;
- configure database/server settings where safely supported;
- configure authentication-related database settings;
- create users/logins/roles;
- grant/revoke privileges;
- enable engine features/extensions;
- define storage/database options where applicable;
- establish initial operational, backup and recovery baseline.

### Phase 6 — Build

Create the application/database structure:

- define schemas;
- create tables, views and other objects;
- compile and execute DDL;
- seed reference data;
- validate types and constraints;
- snapshot the baseline;
- create and apply migrations.

### Phase 7 — Use

Execute application workloads:

- query;
- prepare;
- bind typed values;
- transact;
- stream;
- cancel;
- control deadlines/timeouts;
- use engine-native mechanisms where appropriate.

### Phase 8 — Understand

Make the database estate intelligible:

- metadata and introspection;
- canonical structure tree;
- object identity;
- dependencies and impact;
- capability discovery;
- query plans;
- diagnostics;
- statistics;
- engine/version differences;
- configuration, drift and compatibility analysis.

### Phase 9 — Operate

Run the database safely in production:

- health checks;
- session and connection inspection;
- running-query inspection;
- blocking, locks and deadlock diagnostics;
- resource and capacity inspection;
- storage/database/table/index size analysis;
- maintenance;
- statistics refresh;
- integrity checks;
- index maintenance;
- backup;
- restore;
- recovery verification;
- replication/high-availability visibility;
- audit;
- security administration;
- scheduled database jobs.

### Phase 10 — Change

Evolve both managed databases and the engine/runtime safely:

- schema snapshots, diff and migration;
- data movement/transformation;
- configuration and security changes;
- capacity/topology changes;
- patch/minor updates;
- major-version upgrades;
- edition changes;
- in-place, side-by-side, rolling, logical or replication-assisted migrations;
- upgrade-readiness and compatibility checks;
- post-upgrade validation;
- rollback/recovery planning.

### Phase 11 — Retire

Close the database lifecycle deliberately:

- dependency/consumer inventory;
- final export/archive;
- final backup and restore verification;
- access revocation;
- job/integration shutdown;
- explicitly approved database/schema drop;
- service/instance shutdown;
- engine/runtime uninstall through an explicit provider when requested;
- separately approved removal of database-owned files/data directories;
- final absence verification;
- retained audit/evidence of retirement.

The detailed lifecycle architecture is defined in [END-TO-END-DATABASE-LIFECYCLE.md](END-TO-END-DATABASE-LIFECYCLE.md).

## Product domains

The lifecycle is implemented through eight product domains.

### 1. Engine lifecycle and installation

Owns:

- engine/version/edition selection evidence;
- installation-source/distribution modelling;
- database-specific installation prerequisites;
- installation providers;
- engine installation planning/execution/verification;
- runtime/cluster/instance initialization;
- engine upgrade planning/execution/verification;
- repair/reconfigure integration where supported;
- engine/runtime decommission and uninstall planning;
- destructive decommission gates and evidence.

### 2. Connectivity and runtime

Owns:

- native connections and pools;
- connection configuration and URLs;
- authentication and TLS;
- prepared statements;
- parameter binding;
- transactions and savepoints;
- streaming;
- cancellation and deadlines;
- native protocols;
- errors and retry semantics;
- observability and resource governance.

### 3. SQL language

Owns:

- tokenization;
- parsing;
- AST;
- semantic validation;
- capability-aware compilation;
- rendering;
- rewrite/transpilation;
- DQL, DML, DDL, TCL, DCL, administration and procedural SQL according to product priority.

### 4. Database intelligence

Owns:

- engine/version discovery;
- metadata;
- schema/object discovery;
- canonical object identity;
- dependency analysis;
- execution plans;
- diagnostics;
- statistics;
- capability discovery;
- configuration/limit discovery.

### 5. Database engineering

Owns:

- canonical types;
- schema snapshots;
- schema diff;
- migration planning;
- migration execution;
- data movement;
- transformation/validation;
- compatibility assessment.

### 6. Database administration

Owns database/server administration after the engine/runtime has been initialized:

- database/catalog creation;
- schema bootstrap;
- users/logins/roles;
- privileges;
- database/server configuration;
- extensions/features;
- storage/database options where the engine exposes them;
- maintenance configuration;
- administrative SQL and APIs.

### 7. Database operations

Owns operational management:

- health;
- sessions;
- locks/blocking/deadlocks;
- performance diagnostics;
- capacity/storage;
- maintenance;
- backup/restore;
- recovery;
- replication/HA visibility;
- integrity;
- audit;
- scheduling/job execution;
- upgrade readiness.

### 8. Portability and governance

Owns:

- dialect and DBMS registry;
- capability ontology;
- version differences;
- profile overlays;
- portability decisions;
- compatibility warnings;
- policy/risk classification;
- evidence and qualification state.

## Infrastructure boundary

NuBloxSQL owns **database-specific lifecycle management**, including engine installation and decommissioning, when the action can be expressed through a supported database installation provider or explicit manual/external plan.

NuBloxSQL is **not** a general infrastructure-as-code or operating-system management platform.

NuBloxSQL may own:

- database-engine/version/distribution selection evidence;
- database-specific installation prerequisites;
- PostgreSQL/MySQL/SQL Server/SQLite installation plans;
- explicit package/installer/container/source actions through providers;
- database cluster/instance/data-directory/file initialization;
- database-service start/stop/readiness operations where a provider owns that boundary;
- database-specific repair/reconfigure/upgrade/uninstall actions;
- all existing database administration, operations, engineering and retirement concerns.

Out of scope as core NuBloxSQL responsibilities:

- creating cloud accounts/subscriptions;
- provisioning generic virtual machines;
- creating VPCs/VNETs;
- configuring general-purpose firewalls;
- managing Kubernetes clusters themselves;
- buying or allocating generic cloud infrastructure;
- corporate DNS administration;
- arbitrary operating-system package management unrelated to a database lifecycle provider;
- general remote-shell orchestration.

Infrastructure systems such as Terraform, cloud control planes, Kubernetes and host-management tooling may provide the environment or act as execution providers. NuBloxSQL owns the **database intent, engine-native plan, verification and evidence** at that boundary.

## Server/instance model

NuBloxSQL must understand that database engines expose different containment models.

Examples:

```text
PostgreSQL
server/cluster -> database -> schema -> object

MySQL
server -> database/schema -> object

SQL Server
instance -> database -> schema -> object

SQLite
database file/connection -> attached database -> object
```

The public model may normalize common concepts, but native containment and semantics must remain visible.

## Native depth

Portable abstractions must never force unlike engine behaviours into false equivalence.

Examples:

- PostgreSQL bulk movement should use COPY where appropriate.
- MySQL bulk movement may use controlled LOCAL INFILE.
- SQL Server may use TDS BulkLoadBCP.
- SQLite may use prepared transactional batching.

The same rule applies to backup, maintenance, security, replication, configuration and administration.

Common intent may have a common API; execution remains engine-native.

## Support and evidence states

NuBloxSQL must distinguish:

- known/profiled;
- documented;
- inherited-unverified;
- partially implemented;
- implemented;
- contract-tested;
- live-qualified;
- packaged/public;
- unsupported.

Compatibility branding is never sufficient evidence by itself.

## Non-goals

NuBloxSQL is not:

- an ORM;
- an object model;
- a business application platform;
- a database workbench UI;
- an ERP;
- a replacement SQL database engine;
- a lowest-common-denominator abstraction;
- a general cloud/IaC or arbitrary operating-system management platform;
- a requirement to implement every dialect in the registry.

Downstream products such as a future SQL Workbench may use NuBloxSQL, but NuBloxSQL must have no dependency on them.

## North-star developer experience

A user should be able to learn one coherent model and progressively use more of the lifecycle without replacing the database foundation:

```js
const db = createClient({ dialect: 'postgresql', connectionString });

await db.connect();
await db.query(...);
await db.metadata.tables();
await db.diagnostics.explain(...);
const snapshot = await db.schema.snapshot();
const diff = await db.schema.diff(previousSnapshot, snapshot);
const plan = await db.migrations.plan(diff);
await db.migrations.execute(plan);
await db.close();
```

Future lifecycle domains should feel equally coherent:

```text
server.inspect()
server.databases.create(...)
server.security.roles...
db.maintenance...
db.backup...
db.restore...
db.replication...
db.health...
db.jobs...
db.retire...
```

These names are directional examples, not released API commitments.

## Product decision gate

Before starting any new feature, answer all of the following:

1. Which lifecycle phase does it serve?
2. Which product domain owns it?
3. Which supported engine/user problem does it solve?
4. Is the capability part of database lifecycle management or merely useful to a downstream product?
5. Can a reusable cross-engine concept be defined without hiding native semantics?
6. What engine-specific behaviour must remain visible?
7. What evidence will prove the capability?
8. What is the failure/safety boundary?
9. Is it higher value than the largest open lifecycle gap?
10. Does it preserve NuBloxSQL as a standalone product?

If those questions do not justify the feature, it does not enter the roadmap.

## Current strategic rule

Until the complete lifecycle gaps are represented and prioritised:

- freeze expansion into additional DBMS runtime/profile work;
- do not add another narrow DML/DDL wave merely because adjacent grammar exists;
- prioritise the four supported engines;
- prioritise missing lifecycle foundations;
- treat the dialect registry as future-expansion infrastructure, not the product pitch.

## Product promise

A developer or database engineer should be able to start with NuBloxSQL for database connectivity and continue using the same platform as their needs expand into schema engineering, administration, operations, migration, recovery and automation.

The long-term outcome is:

> **Select. Install. Initialize. Discover. Establish. Build. Use. Understand. Operate. Change. Retire.**
