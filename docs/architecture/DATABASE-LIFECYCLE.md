# End-to-End Database Lifecycle

This document defines the end-to-end lifecycle that NuBloxSQL must ultimately support for a database engine and the databases managed by that engine.

It extends the product boundary from **database-engine selection and installation through retirement and decommissioning**.

## Terminology

NuBloxSQL must distinguish three concepts.

### Dialect

A **dialect** is NuBloxSQL's semantic model for a database family:

- SQL grammar and rendering;
- capability model;
- type behaviour;
- metadata semantics;
- runtime protocol/driver behaviour;
- engine/version differences.

A dialect is software inside NuBloxSQL. The four current executable dialects are PostgreSQL, MySQL, SQLite and SQL Server.

### Engine/runtime

An **engine/runtime** is the database software deployed into an environment:

- PostgreSQL server binaries and cluster tools;
- MySQL Server;
- SQL Server Database Engine;
- SQLite library/runtime.

The engine/runtime is what may need to be acquired, installed, initialized, upgraded, repaired or uninstalled.

### Managed database resource

A **managed database resource** is the concrete database estate created by the runtime:

- PostgreSQL cluster, databases and schemas;
- MySQL server and databases/schemas;
- SQL Server instance, databases and schemas;
- SQLite database files and attached databases.

The end-to-end lifecycle applies to the runtime and the resources it owns.

## Canonical lifecycle

NuBloxSQL now models eleven lifecycle phases.

```text
Select
  ↓
Install
  ↓
Initialize
  ↓
Discover
  ↓
Establish
  ↓
Build
  ↓
Use
  ↓
Understand
  ↓
Operate
  ↓
Change
  ↓
Retire
```

The phases are ordered for lifecycle planning, but production systems move repeatedly between Understand, Operate and Change.

## Phase 1 — Select

Choose the database technology and deployment intent before installation.

NuBloxSQL should be able to represent:

- engine/dialect;
- target version;
- edition/distribution/channel;
- supported platform evidence;
- architecture;
- installation strategy;
- required engine features/components;
- licensing/edition constraints;
- compatibility with the application/database requirements;
- upgrade/support horizon;
- known deprecated/removed features;
- target topology and role.

The output is an immutable **engine selection intent** plus compatibility evidence.

NuBloxSQL should not choose a product merely because it can connect to it. Selection must be explicit and evidence-based.

## Phase 2 — Install

Acquire and install the database engine/runtime.

Common concerns include:

- installation source or media;
- repository/package/channel selection;
- package/binary/installer/container/source strategy;
- version and checksum evidence;
- required runtime components;
- service components;
- database-specific prerequisites;
- administrator/root requirements;
- license acceptance requirements;
- required reboot/restart boundaries;
- installation logging;
- verification of installed binaries/components.

Engine differences must remain visible.

Examples:

- PostgreSQL can be installed from platform packages or built from source.
- MySQL has package, repository, binary, Windows and container installation paths.
- SQL Server Setup has explicit install/configure/repair/upgrade/uninstall workflows and feature selection.
- SQLite is normally an embedded library or executable rather than a long-running server service.

### Installation execution boundary

NuBloxSQL is not a generic operating-system package manager.

The core should own:

- installation intent;
- engine/version/distribution compatibility;
- installation planning;
- database-specific prerequisite checks;
- engine-specific command/action generation;
- safety classification;
- verification;
- audit.

Actual host mutation should occur through an explicit **installation provider**.

A provider may represent:

- local host execution;
- a Windows SQL Server Setup integration;
- a package-manager integration;
- a container runtime integration;
- a remote execution integration;
- a manually executed plan.

Generic VM, VPC/VNET, Kubernetes-cluster and cloud-account provisioning remain outside the NuBloxSQL core.

## Phase 3 — Initialize

Turn installed database software into an initialized database runtime/resource.

This phase includes engine-specific first-run work such as:

- data-directory or cluster initialization;
- system catalog creation;
- instance creation;
- initial service registration/readiness;
- initial administrative identity;
- initial database file creation;
- initial storage/layout choices;
- initial locale/encoding/collation choices;
- bootstrap authentication policy;
- initial TLS/network database-service settings where engine-owned;
- start/stop/readiness checks;
- initial integrity validation.

Examples:

- PostgreSQL uses cluster initialization before normal server operation.
- MySQL initializes its data directory and performs post-install setup.
- SQL Server creates/configures an instance during Setup.
- SQLite normally creates the database file when it is opened or explicitly initialized.

Initialization is distinct from Establish: Initialize creates a viable runtime; Establish configures that runtime for its intended workload.

## Phase 4 — Discover

Understand an initialized or existing environment before changing it:

- engine and exact version;
- edition/distribution;
- instance/cluster identity;
- databases/catalogs;
- installed features/extensions/components;
- server configuration;
- topology;
- security state;
- storage and limits;
- capabilities;
- health and compatibility baseline.

This phase must work for both NuBlox-created and pre-existing estates.

## Phase 5 — Establish

Bring the discovered runtime into the desired operational baseline:

- validate prerequisites;
- create databases/catalogs;
- create schemas/namespaces;
- configure server/database settings;
- establish users/logins/roles and privileges;
- enable extensions/features;
- configure database-owned storage options;
- create initial operational policies;
- establish backup/recovery posture;
- establish monitoring/health baseline.

## Phase 6 — Build

Create database structures and initial content:

- DDL;
- schemas;
- tables;
- views;
- indexes;
- constraints;
- routines/triggers/sequences where supported;
- seed/reference data;
- canonical baseline snapshot;
- migrations.

## Phase 7 — Use

Execute application and engineering workloads:

- query;
- prepare;
- typed bind;
- transact;
- stream;
- cancel;
- timeouts/deadlines;
- bulk movement;
- native mechanisms where appropriate.

## Phase 8 — Understand

Continuously make the database estate intelligible:

- metadata;
- structure tree;
- object identity;
- dependency/impact;
- capability evidence;
- query plans;
- diagnostics;
- statistics;
- configuration evidence;
- version/edition differences;
- drift and compatibility analysis.

Understand is not merely a one-time phase. It feeds Operate, Change and Retire.

## Phase 9 — Operate

Keep the database service healthy and recoverable:

- health;
- sessions/running work;
- locks/blocking/deadlocks;
- resource use;
- capacity/storage;
- statistics;
- maintenance;
- integrity checks;
- backup;
- restore;
- recovery verification;
- replication/HA visibility;
- audit;
- job scheduling/execution;
- security administration.

## Phase 10 — Change

Evolve the database runtime and managed resources safely.

This includes two different change planes.

### Database/resource change

- schema diff;
- migration;
- data movement/transformation;
- configuration changes;
- security changes;
- capacity/storage changes;
- topology changes where safely supported.

### Engine/runtime change

- patch/minor update;
- major-version upgrade;
- edition change;
- side-by-side migration;
- rolling upgrade;
- in-place upgrade;
- logical export/import;
- physical migration;
- replication-assisted migration;
- compatibility-level changes;
- post-upgrade validation;
- rollback/recovery planning.

Upgrade plans must require backup/recovery evidence where the vendor path makes rollback destructive or unsupported.

## Phase 11 — Retire

Close both the managed database resource and, when explicitly requested, the engine/runtime lifecycle.

Retirement must be deliberate and evidence-producing.

### Data/resource retirement

- dependency/consumer inventory;
- final application cutover;
- freeze/writability controls where required;
- final backup/export/archive;
- restore verification;
- retention/legal-policy evidence;
- revoke application and human access;
- disable jobs/integrations;
- remove database-owned secrets/references where NuBloxSQL owns them;
- detach/drop databases and schemas only after explicit destructive approval;
- preserve retirement audit evidence.

### Engine/runtime decommission

- verify no managed databases remain unintentionally;
- stop database services;
- remove instance/cluster registrations;
- archive required configuration/log evidence;
- uninstall engine-specific components through an installation provider;
- optionally remove database-owned data directories/files only under a separately approved destructive step;
- verify service/process/installation absence;
- preserve decommission audit evidence.

Retirement does **not** mean indiscriminately deleting a host, VM, network, cloud account or Kubernetes cluster.

## Durable database job substrate

Lifecycle phases define **what** database work means. Durable jobs define **how long-running, scheduled, resumable and auditable work is coordinated**.

The canonical job architecture is defined in [DATABASE-JOB-ARCHITECTURE.md](DATABASE-JOBS.md).

NuBloxSQL distinguishes:

- **operation** — bounded work in the current request/session;
- **job** — durable work with identity, state, checkpoints, policy and audit;
- **workflow** — a dependency graph coordinating multiple durable jobs and gates.

This job substrate applies across the lifecycle rather than living only inside Operate.

Examples include:

- engine installation/initialization;
- bootstrap and configuration;
- migrations and large data movement;
- scheduled discovery/health;
- maintenance;
- backup/restore;
- capacity/replication checks;
- upgrade;
- retirement.

Engine-native schedulers remain separate native objects and are integrated through adapters rather than flattened into the NuBlox job model.

## Installation provider model

Installation and decommissioning need a provider boundary comparable to the existing database dialect boundary.

A provider should expose intent-oriented operations rather than arbitrary shell access.

Directional interface:

```text
provider.inspectTarget(...)
provider.assessPrerequisites(...)
provider.planInstall(...)
provider.executeInstall(...)
provider.verifyInstall(...)

provider.planInitialize(...)
provider.executeInitialize(...)
provider.verifyInitialize(...)

provider.planUpgrade(...)
provider.executeUpgrade(...)
provider.verifyUpgrade(...)

provider.planUninstall(...)
provider.executeUninstall(...)
provider.verifyUninstall(...)
```

The exact public API must be designed before implementation.

Every plan should classify steps as:

- automatic;
- manual;
- external;
- satisfied;
- blocked.

Every destructive or host-mutating step needs explicit approval and audit.

## Canonical plan evidence

Installation, initialization, upgrade and retirement plans should carry at least:

- immutable plan hash;
- dialect/engine;
- current and target versions;
- edition/distribution;
- target environment identity;
- installation/provider strategy;
- prerequisites;
- required privileges;
- license/acceptance requirements;
- service interruption requirements;
- reboot/restart requirements;
- automatic/manual/external steps;
- destructive steps;
- backup/recovery requirements;
- verification steps;
- rollback/recovery strategy;
- audit metadata.

This should reuse the successful NuBloxSQL pattern already established for bootstrap, migration and configuration planning.

## Engine-specific lifecycle shape

### PostgreSQL

```text
select version/distribution
→ install binaries/packages
→ initialize cluster
→ configure/start
→ discover
→ establish databases/roles/settings
→ build/use/operate
→ patch or major upgrade
→ archive/drop resources
→ stop/decommission cluster
→ uninstall binaries if requested
```

Major upgrades may use dump/restore, `pg_upgrade`, or replication-based migration depending on requirements.

### MySQL

```text
select LTS/Innovation version and distribution
→ install server
→ initialize data directory
→ post-install secure/configure/start
→ discover
→ establish schemas/accounts/settings
→ build/use/operate
→ upgrade readiness
→ supported in-place/logical/replication/clone path
→ archive/drop resources
→ stop/uninstall server if requested
```

Upgrade planning must model supported paths and backup requirements.

### SQL Server

```text
select version/edition/features
→ install Database Engine instance
→ configure instance/services
→ discover
→ establish databases/logins/settings
→ build/use/operate
→ patch/edition upgrade/version upgrade or side-by-side migration
→ post-upgrade database tasks
→ archive/drop databases
→ stop/uninstall instance/features if requested
```

Setup feature/instance semantics remain native and explicit.

### SQLite

```text
select SQLite runtime/build
→ acquire/build/embed library or CLI
→ create/open database file
→ discover PRAGMA/build/runtime evidence
→ establish file/database settings
→ build/use/operate
→ library/file-format compatible upgrade
→ final backup/export
→ close/remove database file only after explicit approval
→ remove embedded runtime/application integration when applicable
```

SQLite must not be forced into a server/instance model it does not have.

## NuBlox Shell lifecycle surface

The Shell should eventually expose the same lifecycle model:

```text
\engine select
\engine inspect
\engine install plan
\engine install
\engine initialize plan
\engine initialize

\server
\databases
\config
\security
\health
\backup
\restore

\engine upgrade inspect
\engine upgrade plan
\engine upgrade

\retire inspect
\retire plan
\retire apply

\engine uninstall plan
\engine uninstall
```

Names are directional until the corresponding public NuBloxSQL APIs exist.

The Shell must remain a consumer of the public API. It must never become the place where installation or upgrade semantics are implemented.

## Development consequence

The previous product boundary—starting only once a server/service was reachable—is no longer sufficient.

The new strategic gap order is:

1. engine/runtime selection and installation model;
2. initialization/readiness model;
3. security administration;
4. health/sessions/maintenance;
5. backup/restore/recovery;
6. durable jobs;
7. replication/HA/capacity;
8. engine upgrade planning/execution;
9. retirement/decommission;
10. remaining language/tooling depth.

This does not require NuBloxSQL to become a cloud or operating-system management product. It requires NuBloxSQL to own the **database-specific lifecycle intent, planning, verification and evidence**, with explicit providers at host/infrastructure boundaries.
