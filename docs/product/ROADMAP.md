# NuBloxSQL Product Roadmap

This roadmap is governed by the [Product Blueprint](BLUEPRINT.md).

NuBloxSQL is being built as **one coherent JavaScript/TypeScript API for the complete SQL database lifecycle**, not as a parser project, ORM, workbench UI or race to support the largest number of dialect names.

## Product focus

Executable engine focus:

- PostgreSQL;
- MySQL;
- SQLite;
- SQL Server.

The dialect/DBMS registry remains future-expansion and knowledge infrastructure. Additional DBMS profile/runtime expansion is frozen until the core lifecycle becomes coherent.

## Lifecycle direction

Development should strengthen the lifecycle in this order:

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

The existing repository is strongest in **Build / Use / Understand / Change**.

The largest strategic deficit is now explicitly **Install / Initialize / Establish / Operate / Retire**.

That means database-engine installation, first-run initialization, administration, security, maintenance, backup/recovery, replication/HA visibility, capacity, engine upgrade, jobs and retirement are not peripheral extras. They are missing parts of the product.

## Frozen work

Until the lifecycle priorities below are substantially addressed:

1. do not add another DBMS runtime/profile solely to increase dialect breadth;
2. do not create another numbered DML/DDL wave merely because adjacent grammar exists;
3. do not couple NuBloxSQL to SQL Workbench, MetaObject, Enterprise OS or any downstream product;
4. do not widen into generic cloud or infrastructure-as-code responsibilities.

Existing registry/profile work remains useful architecture. It is not the current development priority.

## Existing foundation

Released foundations already include:

- PostgreSQL, MySQL and SQLite Tier-1 runtimes;
- SQL Server native runtime with live version qualification;
- prepared statements, transactions, streaming and operation control;
- SQL parser/AST/compiler foundations;
- metadata and introspection;
- structure tree and dependency intelligence;
- query diagnostics;
- canonical type semantics;
- canonical schema snapshots;
- schema diff;
- migration planning and execution;
- portable and engine-accelerated data movement;
- capability ontology, DBMS registry and profile overlay infrastructure.

These capabilities are retained. The roadmap now fills the missing lifecycle around them.

## Priority 1 — Engine selection, installation and initialization

**Status:** engine selection, immutable installation/initialization planning, controlled generic execution, read-only local-host inspection and first-class installation prerequisite assessment are delivered. Local inspection reports platform/architecture, package/container tooling, PATH-visible engine versions and explicitly hinted initialized resources without filesystem crawling or host mutation; prerequisite assessment classifies tooling, elevation, existing-version, setup-platform, provider and license boundaries. Remaining work is versioned vendor-support/media provenance evidence, concrete mutation providers and live install/init qualification.

Build the lifecycle foundation that exists before a database endpoint is reachable.

First scope:

- engine/version/edition/distribution selection evidence;
- supported-platform and prerequisite assessment;
- installation-strategy model;
- installation-provider interface;
- immutable engine installation plans;
- automatic/manual/external/satisfied/blocked step classification;
- privilege, license, restart/reboot and destructive-operation requirements;
- engine installation verification;
- cluster/instance/data-directory/database-file initialization plans;
- start/readiness verification;
- audit and plan-hash approval;
- explicit host/infrastructure execution boundary.

Engine-specific qualification must cover the four supported engines without forcing them into one installation mechanism:

- PostgreSQL package/source/binary and cluster initialization semantics;
- MySQL distribution installation, data-directory initialization and post-install setup;
- SQL Server Setup instance/feature installation semantics;
- SQLite embedded library/CLI/runtime and database-file creation semantics.

Target coverage areas:

- `lifecycle.installation`;
- `lifecycle.initialization`.

The Shell may expose `\\engine install` and `\\engine initialize` only after these capabilities exist in the public NuBloxSQL API.

## Cross-cutting foundation — Durable database jobs and workflows

**Status:** the internal durable job foundation now includes immutable job plans/runs, a validated state machine, executor registry, a file-backed same-host SQLite JobStore, optimistic CAS, atomic run/event persistence, fencing-aware leases, lease renewal, crash/reopen qualification and multi-process lease contention tests. It remains internal: there is no public job API, scheduler, retry runner or workflow runtime yet. A bounded internal worker with checkpointed step execution, heartbeat renewal, fail-closed approval gating and required post-execution verification now exists.

This is now a prerequisite substrate for later lifecycle automation rather than an isolated late feature.

Implement in this order:

1. **Delivered foundation:** JobPlan / JobRun state contracts, checkpoint/event validation, executor registry and storage contract;
2. **Delivered local persistence:** same-host SQLite JobStore with transactional CAS, fencing, renewal and conservative lease recovery;
3. **Delivered worker foundation:** leased job execution, per-step checkpoints, heartbeat renewal, strict verification and conservative failure semantics; next: policy qualification, cancellation/retry and domain-specific adapters;
4. **Started:** read-only `discovery.server` adapter over existing database discovery (four supported dialects, fingerprint verification, no persisted credentials); next: qualified read-only host inspection and explicit policy before any mutation adapters for engine install/init, bootstrap, configuration, migration or data movement;
5. scheduler with timezone, overlap and misfire semantics;
6. workflow DAG with gates, fan-out/fan-in and manual/external waits;
7. read-only discovery of engine-native job systems;
8. native job management only after discovery is qualified.

This kernel should remain specific to database lifecycle work and must not turn NuBloxSQL into a generic CI/CD or infrastructure workflow system.

## Priority 2 — Establish: database bootstrap and administration foundation

**Status:** bootstrap planning/execution, server identity/database discovery, prerequisite assessment, dialect-aware database creation options, configuration discovery, immutable configuration change planning and controlled configuration execution are delivered. Remaining work is security integration, stronger MySQL configuration evidence and live administration qualification.

Build a coherent administration model for a reachable database server/service.

First scope:

- server/instance identity and containment discovery;
- database/catalog enumeration;
- database/catalog creation where supported;
- schema/namespace bootstrap;
- prerequisites and capability validation;
- initial configuration discovery;
- bootstrap plan, dry-run and audit result;
- explicit infrastructure boundary.

The public design should begin from **intent + plan + engine-native execution**, not from a collection of raw CREATE DATABASE strings.

Target coverage areas:

- `administration.bootstrap`;
- `administration.configuration`.

## Priority 3 — Administration security

Create an honest cross-engine security-administration model:

- users/logins;
- roles;
- memberships;
- grants/revokes;
- object privileges;
- ownership;
- authentication-relevant database settings;
- security inspection;
- change planning and audit.

Do not force PostgreSQL roles, MySQL accounts and SQL Server logins/users into false equivalence.

Target coverage area:

- `administration.security`.

This should share foundations with the future DCL compiler rather than producing parallel concepts.

## Priority 4 — Operate: health, sessions and maintenance

Create the first coherent database-operations surface.

Health/diagnostic scope:

- connection/session inventory;
- running operations;
- long-running queries;
- locks;
- blocking;
- deadlock evidence;
- transaction state;
- database health summary;
- native diagnostics retained.

Maintenance scope:

- statistics/analyze;
- vacuum/optimize equivalents;
- index/reindex maintenance;
- integrity checks;
- engine-specific maintenance boundaries.

Target coverage areas:

- `operations.health-sessions`;
- `operations.maintenance`.

## Priority 5 — Backup, restore and recovery

Define the backup/recovery architecture before execution automation.

The common layer should model:

- backup intent;
- backup type;
- target/location abstraction;
- consistency requirements;
- point-in-time/recovery metadata;
- restore plan;
- verification;
- retention metadata;
- destructive-operation gates.

Native mechanisms remain explicit.

Examples include PostgreSQL WAL/logical/physical concepts, MySQL binary-log/physical/logical mechanisms, SQL Server FULL/DIFFERENTIAL/LOG chains, and SQLite backup/file/WAL semantics.

Target coverage area:

- `operations.backup-recovery`.

## Priority 6 — Promote SQL Server toward Tier 1

SQL Server remains the one supported runtime outside the common Tier-1 product model.

Close:

- common capability ontology;
- metadata parity;
- diagnostics parity;
- version policy;
- supported compiler subsets;
- compatibility matrices.

Target coverage area:

- `dialect.sqlserver-parity`.

This work strengthens one of the four supported engines and therefore outranks new DBMS profiles.

## Priority 7 — Expand database job integrations

By this stage the durable job kernel should already exist as a cross-cutting foundation.

Priority 7 therefore expands the kernel into deeper operational/native integrations:

- SQL Server Agent discovery/management;
- MySQL Event Scheduler discovery/management;
- explicit PostgreSQL scheduler adapters;
- SQLite scheduling through NuBlox/application workers;
- richer scheduling policies;
- operational fleet fan-out;
- native history correlation;
- durable notification/event integration.

Target coverage area:

- `automation.jobs`.

## Priority 8 — Replication, HA, capacity and upgrade readiness

Build observation and planning before control.

Replication/HA:

- topology;
- role/primary/replica state;
- lag;
- health;
- failover evidence;
- recovery posture.

Capacity/storage:

- database size;
- table/index size;
- growth;
- native resource limits;
- storage pressure;
- capacity evidence.

Upgrade readiness:

- current/target version;
- capability changes;
- deprecated/removed behavior;
- configuration changes;
- schema/type compatibility;
- migration prerequisites;
- risk report.

Target coverage areas:

- `operations.replication-ha`;
- `operations.capacity-storage`;
- `operations.upgrade-readiness`.

## Priority 9 — Engine upgrade execution

Build engine/runtime upgrade control only after upgrade-readiness, backup/recovery and durable-job foundations exist.

Required scope:

- current/target version path validation;
- vendor-supported upgrade strategy selection;
- backup/recovery evidence gates;
- immutable upgrade plans;
- in-place, side-by-side, rolling, logical and replication-assisted strategy representation where applicable;
- service interruption/restart requirements;
- pre-upgrade compatibility validation;
- execution checkpoints and resumability;
- post-upgrade verification;
- rollback/recovery evidence;
- edition/compatibility-level changes where engine-native.

Target coverage area:

- `lifecycle.engine-upgrade`.

## Priority 10 — Complete change-management foundations

Continue existing strong engineering areas where lifecycle work depends on them:

- durable external migration checkpoints;
- large-transfer qualification;
- richer migration renderer coverage;
- richer canonical types;
- richer dependency/object families;
- lock and safety policies;
- data backfill orchestration.

Target areas:

- schema snapshot/diff;
- migrations;
- migration execution;
- data movement;
- type semantics.

## Priority 11 — Lifecycle retirement

Define explicit end-of-life workflows:

- final export;
- archive;
- final backup;
- backup verification;
- access revocation;
- job/integration shutdown;
- evidence capture;
- explicitly approved drop/decommission steps.

Target coverage area:

- `lifecycle.retirement`.

Retirement must be approval-gated and auditable because it is inherently destructive.

## Priority 12 — SQL tooling

Use the existing SQL engine for standalone developer tooling:

- formatting;
- linting;
- static diagnostics;
- compatibility warnings;
- capability warnings;
- metadata-aware completion primitives;
- safe rewrite suggestions.

Target coverage area:

- `tooling.sql`.

## Priority 13 — Remaining SQL language families

Complete language families when they directly strengthen lifecycle capabilities:

1. TCL for transaction administration and scripting;
2. DCL/security SQL for administration;
3. administration SQL;
4. views/materialized views;
5. triggers and programmability.

Language work should be pulled by product requirements rather than isolated grammar completeness.

## Deferred — additional DBMS profiles and runtimes

MariaDB remains the first documented non-runtime profile overlay.

Further profile research or runtime promotion—CockroachDB, Aurora, TiDB, YugabyteDB and others—is deferred until:

- bootstrap/administration architecture exists;
- health/maintenance architecture exists;
- backup/recovery architecture exists;
- SQL Server Tier-1 status is resolved;
- the four supported engines have coherent lifecycle coverage.

## Infrastructure boundary

NuBloxSQL begins at database-engine selection and may manage database-specific installation, initialization, upgrade and decommissioning through explicit providers. It does not replace Terraform, cloud control planes, Kubernetes, generic VM provisioning or general operating-system administration.

## Release milestone direction

### 1.1.x

Maintain stability. Use patch/minor work for correctness, qualification and narrowly scoped improvements.

### 2.0 readiness

NuBloxSQL 2.0 should represent a **complete database lifecycle architecture**, not merely more SQL grammar.

Minimum architectural requirements:

- canonical eleven-phase end-to-end product/lifecycle definition;
- engine installation-provider and initialization contracts;
- lifecycle coverage register;
- supported-engine boundaries;
- SQL Server Tier-1 decision/parity;
- administration/bootstrap contracts;
- security-administration model;
- health/maintenance model;
- backup/recovery architecture;
- job/execution architecture;
- stable runtime/intelligence/engineering contracts;
- supported-engine qualification;
- clear infrastructure boundary;
- engine upgrade contract;
- documented retirement/decommission model;
- clean JS/TypeScript package qualification.

Not every lifecycle capability must be fully automated at 2.0, but every major domain must have a coherent contract and evidence model.

## Feature admission rule

Every new feature must answer the questions in the [Product Blueprint](BLUEPRINT.md#product-decision-gate).

The key test is:

> **Does this materially improve NuBloxSQL's ability to select, install, initialize, discover, establish, build, use, understand, operate, change or retire SQL database engines and resources?**

If not, it is not a NuBloxSQL priority.
