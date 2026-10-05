# NuBloxSQL Product Definition

This document is the canonical product boundary and planning authority for NuBloxSQL.

If a proposed feature, roadmap item, design discussion or implementation conflicts with this document, this document wins until it is deliberately revised in the repository.

## Product in one sentence

> **NuBloxSQL is a comprehensive JavaScript and TypeScript database engineering and management platform that provides one coherent API across the complete SQL database lifecycle—from discovery and initial setup through development, operation, migration, recovery and retirement—while preserving the native semantics of every supported database engine.**

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

NuBloxSQL owns the database lifecycle from the point at which a database server/service is reachable through to safe retirement.

### Phase 1 — Discover

Understand an existing environment before changing it:

- detect engine and version;
- inspect connectivity and TLS;
- discover databases/catalogs;
- inspect server/instance configuration;
- inspect installed capabilities/extensions;
- inspect topology;
- inspect storage and limits where available;
- establish health and compatibility baseline.

### Phase 2 — Establish

Bring a reachable database server/service into a usable application state:

- validate prerequisites;
- bootstrap connectivity;
- create databases/catalogs where the engine permits;
- create schemas/namespaces;
- configure database/server settings where safely supported;
- configure authentication-related database settings;
- create users/logins/roles;
- grant/revoke privileges;
- enable engine features/extensions;
- define storage/database options where applicable;
- establish initial operational baseline.

### Phase 3 — Build

Create the application/database structure:

- define schemas;
- create tables, views and other objects;
- compile and execute DDL;
- seed reference data;
- validate types and constraints;
- snapshot the baseline;
- create and apply migrations.

### Phase 4 — Use

Execute application workloads:

- query;
- prepare;
- bind typed values;
- transact;
- stream;
- cancel;
- control deadlines/timeouts;
- use engine-native mechanisms where appropriate.

### Phase 5 — Understand

Make the database intelligible:

- metadata and introspection;
- canonical structure tree;
- object identity;
- dependencies and impact;
- capability discovery;
- query plans;
- diagnostics;
- statistics;
- engine/version differences;
- compatibility analysis.

### Phase 6 — Operate

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
- replication visibility;
- high-availability visibility;
- audit;
- security administration;
- scheduled database jobs.

### Phase 7 — Change

Evolve the system safely:

- schema snapshots;
- schema diff;
- migration planning;
- migration execution;
- data movement;
- data transformation;
- upgrade-readiness checks;
- version compatibility analysis;
- configuration change;
- capacity change;
- recovery and failover workflows where safely supported.

### Phase 8 — Retire

Close a database lifecycle deliberately:

- final export;
- archive;
- final backup;
- restore verification where required;
- revoke access;
- disable jobs/integrations;
- remove database-level secrets/references where owned by NuBloxSQL;
- drop database/schema objects where explicitly approved;
- retain audit/evidence of retirement.

## Product domains

The lifecycle is implemented through seven product domains.

### 1. Connectivity and runtime

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

### 2. SQL language

Owns:

- tokenization;
- parsing;
- AST;
- semantic validation;
- capability-aware compilation;
- rendering;
- rewrite/transpilation;
- DQL, DML, DDL, TCL, DCL, administration and procedural SQL according to product priority.

### 3. Database intelligence

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

### 4. Database engineering

Owns:

- canonical types;
- schema snapshots;
- schema diff;
- migration planning;
- migration execution;
- data movement;
- transformation/validation;
- compatibility assessment.

### 5. Database administration

Owns database/server administration after a database service or server endpoint exists:

- database/catalog creation;
- schema bootstrap;
- users/logins/roles;
- privileges;
- database/server configuration;
- extensions/features;
- storage/database options where the engine exposes them;
- maintenance configuration;
- administrative SQL and APIs.

### 6. Database operations

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

### 7. Portability and governance

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

NuBloxSQL manages databases, database servers/instances and database-service configuration where those concerns are exposed through a database protocol, database API, supported executable integration or explicit adapter.

NuBloxSQL is **not** a general infrastructure-as-code platform.

Out of scope as core NuBloxSQL responsibilities:

- creating cloud accounts/subscriptions;
- provisioning generic virtual machines;
- creating VPCs/VNETs;
- configuring general-purpose firewalls;
- managing Kubernetes clusters;
- buying or allocating generic cloud infrastructure;
- corporate DNS administration;
- operating-system package management unrelated to a database integration.

Those tasks belong to infrastructure platforms such as Terraform, cloud control planes, Kubernetes or operating-system tooling.

NuBloxSQL may integrate with them, consume their outputs, or provide database-specific bootstrap steps once a reachable database/server/service exists.

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
- a general cloud/IaC platform;
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

> **Connect. Discover. Establish. Build. Use. Understand. Operate. Change. Retire.**
