# NuBloxSQL Product Vision

The canonical product boundary is defined in [PRODUCT-DEFINITION.md](PRODUCT-DEFINITION.md). This document states the product vision in compact form.

## Vision

> **NuBloxSQL will become the most complete database engineering and management platform for JavaScript and TypeScript: one coherent API across the complete SQL database lifecycle, with deep native support for each database engine rather than lowest-common-denominator abstraction.**

Short form:

> **NuBloxSQL — one API for the complete SQL database lifecycle.**

Governing design rule:

> **One developer API, honest dialect semantics.**

## Lifecycle

NuBloxSQL spans eleven lifecycle phases:

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

This begins before the database service exists. Engine/version selection, database-engine installation, runtime/cluster/instance initialization, initial database setup, configuration, security, operational baselining and administration are first-class database-management concerns.

It continues after application development through maintenance, backup, recovery, replication/HA visibility, capacity management, upgrades, migrations and eventual retirement.

## Product domains

The product is organised into eight domains:

1. **Engine lifecycle and installation** — engine/version/edition selection, installation providers, initialization, upgrade and decommissioning.
2. **Connectivity and runtime** — connections, pools, protocols, authentication, TLS, queries, prepared statements, transactions, streaming and operation control.
3. **SQL language** — parser, AST, semantic validation, compilation, rendering and dialect-aware SQL language families.
4. **Database intelligence** — metadata, structure, dependencies, capabilities, diagnostics, plans, configuration and limits.
5. **Database engineering** — types, schema snapshots, schema diff, migrations, data movement and compatibility assessment.
6. **Database administration** — database/schema bootstrap, users/logins/roles, privileges, configuration, extensions/features and administrative controls.
7. **Database operations** — health, sessions, locks, maintenance, backup/restore, recovery, replication/HA visibility, capacity, integrity, audit and jobs.
8. **Portability and governance** — dialect/version knowledge, capability evidence, compatibility decisions, risk/policy and qualification state.

## Supported engines

The executable product focus is deliberately limited to:

- PostgreSQL;
- MySQL;
- SQLite;
- SQL Server.

The larger dialect/DBMS registry is a knowledge and future-expansion mechanism. It is not the product pitch and does not imply runtime support.

## Scope boundary

NuBloxSQL owns database-specific lifecycle management from engine/runtime selection and installation through database retirement and engine decommissioning, using explicit providers at host/infrastructure boundaries.

NuBloxSQL is not Terraform, a cloud control plane, Kubernetes, a general-purpose operating-system management platform, an ORM, an ERP or a workbench UI.

A future SQL Workbench, CLI, IDE or enterprise application may use NuBloxSQL. NuBloxSQL must not depend on those downstream products.

## North star

A user should be able to adopt NuBloxSQL for connectivity and keep the same platform as requirements grow:

```text
select
install
initialize
connect
query
inspect
configure
secure
build
diagnose
maintain
backup
recover
migrate
move
automate
retire
```

Each common intent should have a coherent NuBloxSQL concept while engine-specific mechanisms and restrictions remain visible.

## Strategic focus

The immediate product priority is no longer expansion into more DBMS profiles.

The priorities are:

1. represent the complete lifecycle in the product capability model;
2. close database administration and operations gaps;
3. maintain and deepen PostgreSQL, MySQL, SQLite and SQL Server;
4. promote SQL Server toward Tier-1 parity;
5. strengthen migration, data movement and automation;
6. build missing security/TCL/administration SQL families where they serve lifecycle capabilities;
7. resume additional DBMS profile/runtime expansion only after the core lifecycle is coherent.

The detailed product boundary, lifecycle phases, user model, infrastructure boundary, support semantics and feature-admission rules are authoritative in [PRODUCT-DEFINITION.md](PRODUCT-DEFINITION.md).
