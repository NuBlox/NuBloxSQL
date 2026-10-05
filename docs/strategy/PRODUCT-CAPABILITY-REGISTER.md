# NuBloxSQL Product Capability Register

The executable source of truth for the current whole-product register is `lib/capabilities/ProductCoverage.js`, with release snapshot `docs/releases/product-coverage-v2.json`. This document explains the assessment and prioritization model.

Status values:

- **Strong** — substantial released implementation and automated qualification exist.
- **Established** — released implementation exists but meaningful depth or consistency work remains.
- **Partial** — some implementation exists, but the area is materially incomplete.
- **Gap** — important product capability is not yet represented as a coherent released subsystem.

This register describes **NuBloxSQL product coverage**, not whether a database engine itself supports a feature.

## Executive assessment

| Product area | Current status | Evidence in repository | Strategic assessment |
| --- | --- | --- | --- |
| Package/public API | Strong | single `nubloxsql` entry point, release-surface checks, clean-install JS/TS consumers | Maintain |
| PostgreSQL runtime | Strong | native protocol, COPY, notifications, cancellation, pooling, portals, result limits, type decoding, diagnostics, deep metadata | Maintain and deepen selectively |
| MySQL runtime | Strong | protocol/auth, prepared statements, typed binds, connection attributes, reset, streaming, control, LOCAL INFILE, diagnostics, deep metadata | Follow `MYSQL-OFFICIAL-DOC-PARITY.md`: compression, session tracking/EOF deprecation, query attributes and Unix sockets next |
| SQLite runtime | Strong | lifecycle, WAL/storage, maintenance, changesets, resource governance, corruption hardening, performance/memory/concurrency qualification | Maintain |
| SQL Server runtime | Established | native TDS, TLS, RPC, streaming, types, collation, sql_variant, live 2019/2022/2025 suites | Promote toward Tier 1 |
| Query compiler | Established | SELECT foundation, CTEs, subqueries, set operators, CASE/CAST, windows | Broaden before more MERGE detail |
| DML compiler | Strong for current Tier-1 scope | INSERT/UPDATE/DELETE, conflict families, UPDATE FROM/DELETE USING, MySQL multi-table DML, PostgreSQL MERGE through dml-v10 | Pause feature-wave expansion |
| DDL compiler | Strong foundation | CREATE/DROP/ALTER lifecycle, constraints, generated/identity, FK semantics, indexes, CTAS, sequence options | Broaden object families |
| Capability ontology | Strong | exhaustive-v1 Tier-1 engine observations, runtime qualification, implementation coverage | Expand implementation-stage precision |
| Dialect / DBMS registry | Established | canonical 100-profile registry, 25 first-class targets, parent-dialect inheritance, versions/driver/wire/language surface metadata | Add product-specific evidence before promoting compatibility profiles to routable support |
| Profile capability overlays | Established | fail-closed baseline inheritance, immutable add/override/remove overlays, version/edition/deployment constraints, explicit evidence/resolution states; first documented MariaDB-over-MySQL overlay | Freeze further profile expansion while complete-lifecycle gaps are addressed |
| Portability/rewrite planner | Established | compatibility, rewrite planning, fail-closed behavior | Needs broader semantic transformation architecture |
| Metadata/introspection | Strong | portable vocabulary, deep PostgreSQL/MySQL metadata, public introspection APIs | Extend consistency and SQL Server parity |
| Structure intelligence | Established | canonical database/schema/object tree with stable object IDs, columns, indexes, foreign keys and constraints | Add descriptions and broader object families |
| Dependency intelligence | Established | deterministic object identity, order-independent dependency graph and impact traversal | Extend to views, routines, triggers, sequences and vendor-native dependency catalogs |
| Query diagnostics | Strong for Tier 1 | portable diagnostics plus native-plan retention; PostgreSQL/MySQL execution analysis, SQLite plan/opcode diagnostics | Add SQL Server to shared contract |
| Transactions | Established | client transaction APIs, savepoints, policy and tests | Need deeper isolation/locking capability integration |
| Streaming/operation control | Strong | async/incremental result handling, cancellation, deadlines, budgets | Maintain |
| Type system | Established | canonical type families, typed-bind bridge, metadata annotation, explicit lossless/lossy/convention mapping decisions, native decoding | Extend arrays, domains/enums, spatial/range/user-defined types and richer precision evidence |
| Security SQL | Gap in compiler | engine capability observations exist; GRANT/REVOKE/roles not a coherent compiled surface | High-value language gap |
| TCL compiler | Gap/Partial | runtime transactions exist; SQL transaction statements are not a first-class compiler family | High-value language gap |
| Views/materialized views | Partial | basic CREATE VIEW exists; broader lifecycle/materialized semantics incomplete | Medium-high |
| Triggers | Gap in compiler | engine observations/runtime support where applicable; no complete AST/compiler family | Medium-high |
| Stored functions/procedures | Gap in compiler | engine observations exist; no coherent procedural SQL compiler | Medium, vendor-heavy |
| Administration SQL | Gap in compiler | diagnostics/runtime operations exist; EXPLAIN/VACUUM/ANALYZE/PRAGMA/etc. not unified compiler families | Medium-high |
| Bulk/data movement | Established foundation | portable cross-dialect mapping, batching, validation, checkpoints/resume and audit/events; transfer planner; PostgreSQL COPY, opt-in MySQL LOCAL INFILE, SQLite prepared-transaction batching and SQL Server TDS BulkLoadBCP acceleration | Add live large-transfer qualification and durable external checkpoint storage |
| Database bootstrap / initial setup | Gap | lifecycle/product definition and partial discovery primitives exist; no coherent bootstrap public API | Priority 1: prerequisites, database/catalog creation, schema bootstrap and audited setup plans |
| Database/server configuration | Gap | engine configuration can be queried in places but no common administration contract exists | Priority 1: discover/change configuration with scope/reload/restart semantics |
| Security administration | Gap | authentication/runtime support exists; users/logins/roles/privileges are not a coherent administration surface | Priority 2: administration model integrated with future DCL |
| Operational health / sessions | Partial | diagnostics and native metadata provide pieces | Priority 3: sessions, running work, blocking, locks, deadlocks and health summary |
| Maintenance | Partial | SQLite has substantial maintenance support; other engines expose capabilities without one common operational API | Priority 3: analyze/statistics, vacuum/optimize, reindex and integrity intents |
| Backup / restore / recovery | Gap | no first-class common contract | Priority 4: plan, execute boundary, restore and verification model |
| Replication / HA | Gap | engine knowledge exists in places; no lifecycle subsystem | Priority 7: topology/role/lag/health observation before control |
| Capacity / storage | Gap | metadata exposes fragments; no coherent capacity model | Priority 7: size, growth, limits and pressure evidence |
| Upgrade readiness | Gap | version/capability knowledge exists but no upgrade assessment | Priority 7: source/target version compatibility and risk assessment |
| Retirement | Gap | no coherent archive/revoke/decommission contract | Priority 9: approval-gated, auditable retirement workflows |
| Automation/jobs | Gap | no unified reusable job-plan or CLI execution model | High platform value |
| Reporting/export | Gap | no first-class report/export contract | Build after unified data movement |
| Competitive benchmark | Active | `docs/strategy/COMPETITIVE-BENCHMARK.md` | Track breadth without copying external product architecture |
| Canonical schema snapshot | Established | deterministic schema model with stable IDs, dialect-neutral logical keys, canonical types, dependencies and semantic/source hashes | Use as the source model for schema diff |
| Schema diff | Established | logical-key comparison, added/removed/modified changes, property deltas, dependency-edge changes and conservative safety classification | Add rename inference and richer object-family comparison |
| Migration planner | Established | ordered safety-classified plans, automatic/manual execution boundaries, target-dialect DDL for supported steps, preconditions and rollback metadata | Expand DDL coverage and runtime qualification |
| Migration execution | Established | dry-run, approval gates, resumable checkpoints, audit records, failure recovery, opt-in transaction wrapping and post-execution verification | Add persistent checkpoint/job storage, richer lock policy and data-backfill orchestration |
| SQL formatting/linting/static analysis | Gap | parser/AST foundations exist | High value for the standalone tooling surface |
| SQL Server ontology parity | Gap | SQL Server is Tier 2 and outside shared exhaustive ontology/diagnostics contracts | High strategic priority |
| Performance benchmarking | Partial | SQLite production suite strong; other dialect performance evidence less productized | Medium |
| Extension/plugin architecture | Partial | dialect-native features exist; no clearly defined external extension contract | Medium/long-term |

## Verified repository facts

The current release already contains significantly more than a compiler:

- PostgreSQL native protocol and runtime qualification.
- MySQL native protocol and runtime qualification.
- SQLite production performance, memory, concurrency and corrupt-input qualification.
- SQL Server native TDS implementation and live regression suites.
- portable metadata and native-rich metadata.
- portable query diagnostics with native-plan retention.
- prepared statements, transactions, streaming, operation control and observability.
- an executable capability ontology with exhaustive-v1 Tier-1 observations.
- a substantial query/DML/DDL compiler and transpilation surface.

The recent development sequence over-emphasized the SQL compiler relative to these other pillars. That is a **roadmap imbalance**, not evidence that the product itself has become only a parser.

## Capability maturity dimensions

Future product reviews should score important capabilities across these dimensions:

| Dimension | Meaning |
| --- | --- |
| Engine observation | We know whether and how each engine supports the capability |
| Public API | A stable developer-facing contract exists where appropriate |
| Parser/AST | SQL form has a structured representation where appropriate |
| Semantic validation | Invalid or unsafe combinations fail before execution |
| Renderer | Structured form can be rendered correctly |
| Runtime implementation | Execution/runtime behavior is implemented where applicable |
| Runtime qualification | Version/configuration-dependent behavior can be proven |
| Portability decision | Cross-dialect behavior is explicitly native/equivalent/rewrite/emulate/reject |
| Metadata/introspection | The capability can be discovered from a database where appropriate |
| Diagnostics/observability | Operational behavior can be diagnosed where appropriate |
| Contract tests | Deterministic tests protect the public contract |
| Live qualification | Real supported engines prove behavior |
| Packaging/docs | The released npm artifact and documentation expose the capability correctly |

## Priority model

Roadmap priority should be calculated qualitatively from:

1. **Platform leverage** — how broadly the capability strengthens NuBloxSQL itself.
2. **Breadth** — number of engines and product pillars improved.
3. **Risk reduction** — correctness, security, data-loss or operational risk addressed.
4. **Coverage deficit** — size of the current gap.
5. **Reuse** — whether the work creates reusable infrastructure instead of one-off grammar.
6. **Release impact** — whether users gain a coherent capability they can understand and adopt.

A narrow vendor grammar edge should not outrank a missing cross-product subsystem merely because it is easier to implement next.
