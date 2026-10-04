# NuBloxSQL Strategic Roadmap

This roadmap replaces feature-wave momentum with product-coverage priorities.

## Direction

The competitive capability programme is documented in [COMPETITIVE-BENCHMARK.md](COMPETITIVE-BENCHMARK.md). Database Tour is used as a breadth benchmark for database exploration, SQL tooling, data movement, automation and reporting; NuBloxSQL remains an independent product and does not copy its implementation or UI.


The immediate objective is to turn NuBloxSQL from a strong multi-dialect database integration package with an increasingly capable compiler into a **balanced database platform**.

The next work should strengthen missing horizontal capabilities before returning to deep vendor grammar edges.

## Priority 0 — freeze statement-family churn

Until the items below are reviewed, do not create another `dml-v*` or `ddl-v*` wave merely because an adjacent grammar feature exists.

Existing dml-v1 through dml-v10 and ddl-v1 through ddl-v11 remain released capability scopes. They are not deprecated.

New compiler scopes should require a capability-register justification.

## Priority 1 — capability coverage dashboard

**Status:** implemented as Product Coverage Model v2. The public `productCoverage` API and `docs/releases/product-coverage-v2.json` now provide the machine-readable whole-product register; future roadmap decisions should update this model and its evidence.

Create a machine-readable product coverage register derived from:

- capability ontology definitions and observations;
- NuBlox implementation stages;
- runtime tests;
- live engine qualification;
- public API manifests;
- metadata/diagnostics contracts.

The output should answer:

- what the engine supports;
- what NuBloxSQL observes;
- what NuBloxSQL implements;
- at which maturity stage;
- which dialects are live-qualified;
- which product pillar owns the capability;
- what remains missing.

This should become the planning source of truth.

### Required improvement to ontology implementation metadata

Current implementation records are compiler-centric and use a compact stage model.

Expand implementation maturity so it can represent at least:

- parser;
- AST;
- semantic validator;
- renderer;
- rewrite/portability decision;
- runtime;
- introspection;
- diagnostics;
- contract test;
- live qualification;
- packaged/public;
- documentation.

This lets the ontology describe the whole product rather than mainly compiler coverage.

## Priority 2 — promote SQL Server toward Tier 1

SQL Server already has meaningful native runtime depth and live qualification.

The strategic gap is product parity:

- include SQL Server in the common capability ontology;
- add portable metadata-vocabulary parity;
- add shared query-diagnostics contract support;
- define version qualification policy;
- add SQL Server to compatibility matrices where evidence exists;
- determine which compiler subsets can be responsibly promoted.

This yields more product value than another narrow PostgreSQL MERGE extension.

## Priority 3 — canonical type semantics

**Status:** first released canonical type semantics slice delivered. Metadata inference, typed-bind integration and cross-dialect mapping decisions are now public; remaining work is advanced/vendor-specific type families.

Build a product-level type system that connects:

- SQL type AST;
- typed binds;
- result decoding;
- metadata types;
- dialect type names;
- precision/scale/length;
- nullability;
- temporal semantics;
- binary/text encodings;
- JSON;
- UUID/GUID;
- arrays where supported;
- enum/domain/native user-defined types;
- portability/lossiness.

The type system should produce explicit mapping decisions such as:

```text
native-equivalent
lossless-map
lossy-map
application-convention
unsupported
runtime-qualified
```

This is foundational for schema migration, metadata fidelity, generated models and cross-dialect correctness.

## Priority 4 — schema diff and migration planning

**Status:** canonical schema snapshot, schema diff, migration planning and the first migration-execution layer are delivered. The next platform slice is unified data movement plus broader migration renderer/runtime qualification.

Use the existing metadata, DDL AST and capability planner to build:

```text
database snapshot A
        |
        v
canonical schema model
        |
        +--> diff
        |
        v
migration plan
        |
        +--> safety classification
        +--> capability requirements
        +--> dialect-specific DDL
        +--> manual-action boundaries
```

Initial scope:

- schemas/namespaces;
- tables;
- columns;
- types;
- defaults;
- nullability;
- primary/unique/check/foreign-key constraints;
- indexes;
- generated/identity behavior.

Migration planning must distinguish:

- additive;
- destructive;
- potentially data-losing;
- rewrite/rebuild required;
- lock-sensitive;
- unsupported automatically.

This is one of the highest-leverage foundations in the NuBloxSQL platform.

## Priority 5 — complete major SQL language families

After the platform foundations above, broaden the compiler by **family**, not by isolated clause.

Recommended order:

### 5A. Transaction-control SQL

Structured support for:

- BEGIN / START TRANSACTION;
- COMMIT;
- ROLLBACK;
- SAVEPOINT;
- RELEASE SAVEPOINT;
- transaction characteristics/isolation where defensibly modeled.

Connect compiler semantics to the existing runtime transaction policy.

### 5B. Security/control SQL

Structured support for engine-appropriate:

- GRANT;
- REVOKE;
- roles/users where applicable;
- ownership/authorization semantics;
- role/session authorization controls.

Do not normalize unlike account/role models into false equivalence.

### 5C. Views and materialized views

Complete lifecycle and options for:

- CREATE/ALTER/DROP VIEW;
- materialized views where supported;
- refresh semantics;
- check options/security behavior where relevant;
- dependency behavior.

### 5D. Administration/query-plan statements

Model important operational SQL families:

- EXPLAIN;
- ANALYZE;
- VACUUM;
- REINDEX;
- engine-specific maintenance commands;
- PRAGMA as a SQLite-specific family where appropriate.

Connect these to diagnostics APIs instead of building parallel concepts.

### 5E. Triggers and programmability

Only after the broader common platform is stronger:

- triggers;
- stored functions;
- procedures;
- anonymous blocks;
- vendor procedural languages.

These are high-complexity and highly vendor-specific, so they should not displace the earlier cross-product foundations.

## Priority 6 — standalone SQL tooling foundations

Leverage the parser/AST/intelligence layer for tooling capabilities:

- syntax diagnostics;
- AST inspection;
- formatting;
- linting;
- capability warnings;
- version compatibility warnings;
- query-plan integration;
- metadata-aware completion primitives;
- safe rewrite suggestions.

This strengthens NuBloxSQL as a complete database platform rather than only an execution runtime.


## Near-term implementation sequence

Recommended next engineering sequence:

1. **Product coverage model v2** — machine-readable whole-product implementation stages.
2. **Database structure intelligence** — canonical structure tree, stable object identity and dependency/impact graph delivered; extend toward descriptions and richer object families.
3. **SQL Server Tier-1 parity plan and first parity slice**.
4. **Canonical type-system architecture and mapping register** — first released slice delivered; continue advanced type families as required by schema-diff work.
5. **Canonical schema snapshot** — delivered; deterministic semantic/source fingerprints now provide the diff foundation.
6. **Schema diff model** — first released layer delivered; continue rename inference and richer vendor objects as migration planning requires.
7. **Migration planner MVP** — delivered; extend renderer coverage and runtime qualification as the execution layer is built.
8. **Migration execution engine** — delivered; continue persistent checkpoints, richer lock policy and backfill orchestration through generic job infrastructure.
9. **Unified data-movement engine** — portable resumable pipeline plus native PostgreSQL COPY, opt-in MySQL LOCAL INFILE and SQL Server TDS BulkLoadBCP transfer planning delivered; continue SQLite prepared-write tuning, durable checkpoints and large-transfer qualification.
10. **Standalone SQL tooling services**.
11. **Automation/job execution model**.
12. **TCL/security/administration language families**, prioritized from the coverage register.
13. **Reporting/export contracts** after the data pipeline is stable.
14. Reassess the register before additional narrow DML/DDL depth.

## Release milestone proposal

### 1.1.x

Keep the current release stable and use patch/minor work for correctness, qualification and narrowly scoped compatibility fixes.

### 2.0 readiness

A 2.0 release candidate should require:

- whole-product capability coverage register;
- SQL Server promotion decision with defined parity status;
- canonical type semantics;
- first-class schema diff/migration architecture;
- stable runtime/introspection/diagnostics contracts;
- compiler family roadmap based on coverage gaps;
- clean JS/TypeScript package qualification;
- supported-engine live matrices;
- documented standalone product contracts for runtime, language, metadata, diagnostics, portability and tooling.

## Decision rule for future work

Before starting a new feature, answer:

1. Which product pillar does it improve?
2. Which capability-register gap does it close?
3. Which NuBloxSQL product capability becomes materially stronger?
4. Is there a broader reusable abstraction that should be built first?
5. What live evidence will prove it?
6. Is this higher value than the largest currently open product gap?

If those questions do not justify the work, it should not be the next milestone.
