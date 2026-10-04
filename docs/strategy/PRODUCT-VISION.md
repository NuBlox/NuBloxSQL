# NuBloxSQL Product Vision

## Purpose

NuBloxSQL is a NuBlox-owned database platform for Node.js.

Its purpose is not merely to parse or render SQL. It provides one coherent developer surface over multiple database engines while preserving the semantics that make each engine different.

The governing design rule is:

> **One developer API, honest dialect semantics.**

NuBloxSQL should be usable as a standalone database integration platform and as foundational infrastructure for higher NuBlox products such as MetaObject, SQL Workbench and application platforms.

## Product architecture

NuBloxSQL has five product pillars.

### 1. Database runtime

The runtime owns connection lifecycle and execution:

- client and pool creation;
- connection URLs and configuration;
- prepared statements and typed binding;
- transactions, savepoints and retry policy;
- streaming and incremental result handling;
- cancellation, timeouts, deadlines and result budgets;
- protocol-specific behavior;
- portable errors with native diagnostics retained;
- observability and resource governance.

### 2. SQL language platform

The language platform owns SQL understanding and generation:

- tokenizer;
- dialect-aware parser;
- structured AST;
- semantic validation;
- capability analysis;
- rewrite/compatibility planning;
- renderer/compiler;
- parameter-origin preservation;
- version-qualified vendor semantics.

This subsystem must cover queries, DML, DDL, transaction control, security/control statements, programmability and administration according to product priority. It must not become the entire product.

### 3. Database intelligence

The intelligence layer makes a database understandable:

- metadata and schema introspection;
- portable metadata vocabulary;
- native-rich metadata retention;
- query diagnostics and execution plans;
- capability discovery;
- engine/version detection;
- limits and runtime feature discovery;
- statistics and operational diagnostics where defensible.

### 4. Portability and compatibility

NuBloxSQL should explain whether SQL and database behavior can move between engines.

The portability engine owns:

- atomic capability ontology;
- engine observations;
- implementation coverage;
- runtime qualification;
- compatibility matrices;
- rewrite decisions;
- migration-surface analysis;
- fail-closed behavior when semantic equivalence is not defensible.

Portability does **not** mean forcing unlike features into a common syntax.

### 5. Dialect depth

Each supported engine must retain native depth.

Current engine families:

- PostgreSQL;
- MySQL;
- SQLite;
- SQL Server.

A portable API should exist where semantics genuinely align. Engine-native access should remain available where hiding differences would reduce correctness or capability.

## Architectural relationship

```text
Applications / ORMs / tooling
            |
            v
        NuBloxSQL
            |
   +--------+---------+----------+-------------+
   |                  |          |             |
Runtime           Language   Intelligence   Portability
   |                  |          |             |
   +------------------+----------+-------------+
                      |
         Native dialect implementations
       PostgreSQL / MySQL / SQLite / SQL Server
```

Potential NuBlox consumers:

```text
NuBloxSQL
   |
   +--> NuBlox MetaObject / ORM
   |
   +--> NuBlox SQL Workbench
   |
   +--> NuBlox application services
```

## Product principles

1. **Correctness before convenience.** Unsupported or semantically unsafe translations fail closed.
2. **Native depth without API fragmentation.** A single package may expose common and native-specific surfaces.
3. **Evidence-backed claims.** Released capability claims require implementation and automated qualification.
4. **Version awareness.** Database capability changes across versions must be represented explicitly.
5. **No parser-first roadmap.** Development priority is decided from product coverage, risk and downstream value rather than the next available grammar feature.
6. **Reusable foundations.** New language support should extend shared AST, compiler, capability and binder infrastructure rather than creating isolated statement parsers.
7. **Downstream usefulness.** NuBloxSQL should make MetaObject, SQL Workbench and future NuBlox applications easier to build.
8. **Operational quality is product functionality.** Pooling, cancellation, memory behavior, protocol correctness, observability and recovery are first-class concerns.
9. **Portable views retain native evidence.** Normalization must not discard engine-specific detail.
10. **One public release surface.** The package remains a coherent product rather than a collection of unrelated dialect packages.

## Completion model

A capability is not considered fully delivered merely because syntax parses.

The maturity path is:

```text
Observed
  -> Parsed
  -> Structured AST
  -> Semantically validated
  -> Rendered
  -> Capability-mapped
  -> Runtime-qualified where required
  -> Cross-dialect behavior decided
  -> Contract-tested
  -> Live-engine-qualified
  -> Packaged and documented
```

Different product pillars have analogous evidence paths. Runtime capabilities require protocol/runtime qualification; metadata capabilities require fidelity checks; diagnostics require native-plan retention and portable normalization evidence.

## Strategic milestone

The next strategic milestone is:

> **NuBloxSQL 2.0 — Complete Tier-1 SQL Platform Architecture**

This milestone is not defined by adding more numbered DML or DDL waves. It is defined by balanced, release-qualified product coverage across the runtime, language, intelligence, portability and dialect-depth pillars.

The development roadmap must therefore be generated from the product capability register rather than from statement-family momentum.
