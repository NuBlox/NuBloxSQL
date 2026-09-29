# NuBloxSQL Design Intent

## Product intent

NuBloxSQL exists to be the **NuBlox-owned database connectivity and runtime substrate** for SQL-based systems.

The project is not intended to be a set of unrelated database clients that merely happen to live in one repository. It is one platform whose adapters share a deliberate contract model, quality bar and consumer-facing architecture while retaining each database engine's native strengths and semantics.

The long-term objective is that database-consuming NuBlox products — especially NuBlox SQL Workbench — depend on NuBloxSQL for database connectivity and runtime behaviour instead of embedding or directly depending on separate third-party driver stacks for every database family.

## The problem NuBloxSQL solves

Database engines overlap in broad concepts but diverge heavily in details:

- connection and session models;
- authentication and transport;
- parameter syntax;
- prepared-statement lifecycle;
- transaction and savepoint semantics;
- cancellation;
- catalogs, databases and schemas;
- type systems;
- result metadata;
- cursors and streaming;
- locking and concurrency;
- replication/change-data-capture;
- diagnostics and errors;
- administration and metadata discovery.

A poor abstraction either leaks everything to consumers or hides important differences behind misleading generic APIs.

NuBloxSQL takes a third approach: **define strong portable contracts only where the semantics are genuinely portable, then expose first-class native capabilities for everything else.**

## Architectural layers

### 1. Portable platform contracts

`@nublox/sql-core` defines the semantic vocabulary shared across adapters.

Examples include:

- dialect identity;
- capability discovery;
- object-name hierarchy;
- execution/result categories;
- operation cancellation/timeout vocabulary;
- result/resource limits;
- transaction policy;
- error categories and native diagnostic preservation;
- portable metadata shapes;
- explicit native extension points.

SQL Core is not an ORM, SQL parser, connection proxy or wrapper around adapter APIs. It is the stable contract language of the platform.

### 2. Dialect services

Each database family owns SQL-level semantics that cannot be centralised safely:

- identifier quoting;
- parameter placeholders;
- version-dependent feature support;
- catalog/schema meaning;
- SQL syntax differences;
- type-affinity/type-system behaviour.

These services allow higher-level consumers to reason about dialects without assuming that all SQL engines behave the same way.

### 3. Native adapter runtimes

Each adapter is responsible for the real database runtime.

For client/server engines this includes protocol framing, authentication, TLS, prepared execution, cancellation, pooling, session state and wire-level error handling.

For embedded engines this includes storage lifecycle, locking, transaction modes and runtime-specific APIs.

Adapters may expose native extensions beyond the portable contract. That is intentional.

### 4. Consumer integration

Consumers should build tool-facing behaviour above NuBloxSQL rather than reimplement database transport logic.

For NuBlox SQL Workbench, examples include:

- connection-management UX;
- query editor requests;
- object explorer presentation;
- schema design;
- administration workflows;
- migration tooling;
- diagnostics presentation.

The Workbench should ask a NuBloxSQL adapter to perform database work; it should not become the owner of MySQL, PostgreSQL, SQLite, SQL Server or Oracle transport implementations.

## Core design invariants

The following are architectural rules, not preferences.

### One platform, multiple native runtimes

Independent package versioning exists because database engines and adapters evolve independently. It does not mean the packages are separate products with separate design philosophies.

### No lowest-common-denominator API

NuBloxSQL must not discard important database-native semantics merely to make APIs look identical.

### No silent semantic emulation

If a feature is unsupported or materially different, capability metadata or an explicit adapter API must make that visible.

### Native escape hatches are first class

Consumers must be able to use database-specific power without bypassing NuBloxSQL entirely.

### Data fidelity before convenience

Types must not be coerced in ways that silently lose precision, timezone meaning, binary fidelity or vendor semantics.

### Portable contracts are earned

A concept should move into SQL Core only when multiple real adapters prove that the abstraction is useful and semantically honest.

### Consumers do not own transports

NuBloxSQL owns database runtime behaviour. Consumer applications own user workflows and product-specific behaviour.

### Stable support is evidence-based

A database/runtime version becomes supported only when CI, live integration, failure-path, security and release evidence justify the claim.

## Target platform shape

```text
                    Consumer products
     ┌────────────────────┼────────────────────┐
     │                    │                    │
 SQL Workbench       NuBlox apps        Other consumers
     └────────────────────┼────────────────────┘
                          ▼
                 NuBloxSQL platform
                          │
                 @nublox/sql-core
                          │
       ┌──────────┬───────┼────────┬──────────┐
       ▼          ▼       ▼        ▼          ▼
     MySQL    PostgreSQL SQLite SQL Server   Oracle
       │          │       │        │          │
       ▼          ▼       ▼        ▼          ▼
 native runtime per database family
```

## What NuBloxSQL is not

NuBloxSQL is not intended to be:

- an ORM;
- a universal SQL transpiler;
- a schema-design UI;
- a lowest-common-denominator driver facade;
- a place to copy vendor-specific features into SQL Core without proof;
- a dependency-injection layer over third-party drivers as the final architecture;
- part of SQL Workbench itself.

## Development consequence

Every new adapter should improve both its own native implementation and the quality of the platform model.

When a new dialect exposes a weakness in SQL Core, the correct response is to examine the abstraction. The goal is not to force the new dialect to fit an existing MySQL- or PostgreSQL-shaped API.

That is why PostgreSQL was the second reference dialect, SQLite is the embedded-database pressure test, and SQL Server and Oracle are valuable later tests of session, type, metadata and enterprise-database semantics.
