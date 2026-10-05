# NuBloxSQL Strategic Roadmap

This roadmap is governed by [PRODUCT-DEFINITION.md](PRODUCT-DEFINITION.md).

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
Discover
  -> Establish
     -> Build
        -> Use
           -> Understand
              -> Operate
                 -> Change
                    -> Retire
```

The existing repository is strongest in **Build / Use / Understand / Change**.

The largest strategic deficit is now explicitly **Establish / Operate / Retire**.

That means initial setup, administration, security, maintenance, backup/recovery, replication/HA visibility, capacity, upgrade readiness, jobs and retirement are not peripheral extras. They are missing parts of the product.

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

## Priority 1 — Establish: database bootstrap and administration foundation

**Status:** first bootstrap slice delivered: immutable planning, inspection, dry-run, database/schema creation execution, engine-specific scope boundaries, verification and audit. Remaining work is prerequisite/server discovery, database options, configuration/security integration and live bootstrap qualification.

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

## Priority 2 — Administration security

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

## Priority 3 — Operate: health, sessions and maintenance

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

## Priority 4 — Backup, restore and recovery

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

## Priority 5 — Promote SQL Server toward Tier 1

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

## Priority 6 — Jobs and durable execution infrastructure

Create reusable database job infrastructure for long-running and scheduled lifecycle work.

Required foundations:

- job definition;
- immutable plan;
- state;
- checkpoints;
- attempts;
- resumability;
- cancellation;
- audit;
- logs/events;
- scheduling contract;
- lease/lock model;
- idempotency.

Use it for:

- backup;
- restore;
- maintenance;
- large data movement;
- migration backfills;
- health collection;
- scheduled integrity checks;
- future operational workflows.

Target coverage area:

- `automation.jobs`.

## Priority 7 — Replication, HA, capacity and upgrade readiness

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

## Priority 8 — Complete change-management foundations

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

## Priority 9 — Lifecycle retirement

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

## Priority 10 — SQL tooling

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

## Priority 11 — Remaining SQL language families

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

NuBloxSQL begins once there is a database server/service endpoint or database file to manage.

NuBloxSQL may manage database-specific configuration and lifecycle operations. It does not replace Terraform, cloud control planes, Kubernetes or general operating-system administration.

## Release milestone direction

### 1.1.x

Maintain stability. Use patch/minor work for correctness, qualification and narrowly scoped improvements.

### 2.0 readiness

NuBloxSQL 2.0 should represent a **complete database lifecycle architecture**, not merely more SQL grammar.

Minimum architectural requirements:

- canonical product/lifecycle definition;
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
- documented retirement model;
- clean JS/TypeScript package qualification.

Not every lifecycle capability must be fully automated at 2.0, but every major domain must have a coherent contract and evidence model.

## Feature admission rule

Every new feature must answer the ten questions in [PRODUCT-DEFINITION.md](PRODUCT-DEFINITION.md#product-decision-gate).

The key test is:

> **Does this materially improve NuBloxSQL's ability to discover, establish, build, use, understand, operate, change or retire SQL databases?**

If not, it is not a NuBloxSQL priority.
