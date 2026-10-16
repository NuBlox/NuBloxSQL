# Roadmap — gated, not date-driven

**The objective is to make NuBloxSQL the database technology platform of choice, not to maximise file count or confuse the first demo with the entire product.** Build progressively with explicit gates. [PRODUCT.md](PRODUCT.md) is the fixed strategic authority; stages are delivery sequencing, not permission to redefine scope.

## Source reuse is mandatory before replacement engineering

The preserved [legacy archive](ARCHIVE.md) contains materially broader first-party PostgreSQL/MySQL/SQL Server/Redis source and query/schema/migration modules than the current narrow private implementation. Its code is **not** automatically qualified. For each next native adapter or developer technology, first perform the documented source/dependency/security review, run targeted isolated archived tests, compare public APIs, then qualify only selected components on live current DBMS fixtures.

**Immediate priority:** audit the archived PostgreSQL protocol, session management, SCRAM/TLS and tests against the newly implemented loopback-only PostgreSQL inventory client. Build a single improved, coherent current implementation after evidence review; **do not create a third PostgreSQL implementation**. In parallel, assess AST/compiler, schema diff and migration assets before creating ORM/query-builder and migration APIs. The historical MongoDB adapter relies on a third-party client and must not be promoted as first-party.

## Stage 0 — preserve and simplify (this reset)

- [x] Capture the complete former implementation in a named archive ref.
- [x] Establish a clean docs-only default branch without legacy runtime/test/workflow clutter.
- [x] Define one product authority, traceable requirements, boundaries, task register and quality gates.
- [x] Catalogue 64 *candidate* professional activities, preserving archived provenance and marking scope limits.
- [ ] Review, split/merge and approve the candidate activities relevant to the first real-world task; separate engineering reuse from product scope acceptance.
- [ ] Review the proposed baseline and decide the first product demonstration.
- [x] Apply GitHub branch/ruleset protection to both the default and archived refs (live GitHub API verified; optional owner CLI endpoint check remains in issue #328).

**Exit:** the overall platform vision and first task are explicit, decisions tracked, and a reviewer can explain how the native Driver, independent developer technologies, Shell and Workbench contribute to the same mission.

## Stage 1 — specify one actual task end to end

**Accepted G0 engineering target:** [TASK-001](TASK-001.md), PostgreSQL 17 native catalogue inspection producing one versioned inventory through Driver, Shell and Workbench. Initial choices are documented; the release claims remain explicitly unqualified.

- [x] Resolve the [TASK-001 specification](TASK-001.md), [inventory JSON Schema](contracts/database-inventory-v1.schema.json) and [error schema](contracts/database-operation-error-v1.schema.json) into an accepted G0 engineering contract: PostgreSQL 17, bounded read-only queries, API/CLI naming, secret boundary and TLS policy.
- [x] Validate positive, partial and negative work-product examples in docs-only CI.
- [x] Remove `pg` and `@types/pg` from the live dependency lockfile, restore strict `npm ci`, and validate the NuBloxSQL-owned PostgreSQL v3/SCRAM/extended-query inventory slice against the digest-pinned PostgreSQL 17 CI fixture (PR #341). This remains **limited** protocol qualification.
- [ ] Complete G1 package-consumer smoke tests, resource/timeout/security negative cases and Workbench build boundaries. G2/G3 release qualification remains incomplete.
- Define one typed Driver API request/result/error contract.
- Define credentials, TLS, privileges, timeouts, safe output, target identity and failure cases.
- Design Shell help/script output and Workbench user journey based on the same result schema.
- Choose test fixture versions and acceptance test scripts.
- Decide how to use the archived implementation without adopting its legacy structure.

**Exit:** reviewed requirements, schema examples, native conformance matrix and end-to-end acceptance scenarios. **No implementation code until this is approved.**

## Stage 2 — establish a small reproducible development toolchain

- Choose monorepo/workspace packaging and TypeScript build standards.
- Create only the Driver, Shell and Workbench structure needed for TASK-001 (initial Driver/Shell packages are present; Workbench will be added after qualified public API integration).
- Set up Node LTS, typechecking, linting, unit/security tests and first live database fixture. Retain independent archived reference-test evidence without passing it off as current product qualification.
- Add package/public API boundary guards; remain proprietary under LICENSE.

**Exit:** completely reproducible clean install, build and tests, including package smoke tests.

## Stage 3 — deliver the first vertical slice

- Build a minimal native PostgreSQL adapter and real connection/identity discovery.
- Complete the Driver API and secure error/resource handling.
- Make Shell and Workbench **each** perform TASK-001 using that API.
- Produce and compare machine-readable inventory evidence and clear failure messages.

**Exit:** live database → Driver → both tools → verified work product with negative and recovery tests.

## Stage 4 — qualify and extend

- Expand TASK-002 to TASK-004 and ship independently qualified pre-release deliverables.
- Qualify additional SQL versions/engines and the first managed-cloud target.
- Bring in other model-native adapters on their own evidence merits; don't confuse catalogue breadth with runtime support.
- Expand the lifecycle work register and priority professional workflows as actual users validate them.

**Exit:** separate product release qualifications; supported/unsupported matrix published and reproducible.

## Stage 5 — complete the professional database lifecycle

Expand securely into selection, installation, initialization, administration, monitoring, backup/restore, migration, upgrades and retirement, with real vendor-specific implementations and recovery tests. Every increment must close a traceable task and meet the relevant quality gate.

## Evidence-driven next implementation order

1. **PostgreSQL consolidation:** compare archived and current native wire components; select verified and more complete first-party implementation strategy; retain TASK-001 API and real-engine acceptance. Add native TLS/SCRAM variant testing before network or cloud support is claimed.
2. **Core language/query reuse:** review archived parser/compiler/dialect/type subsystems and their tests; establish shared native query/metadata contracts and developer-facing query builder goals.
3. **First ORM/query builder design:** specify independently consumable contracts and acceptance tests; the archive's compiler does not by itself deliver an ORM or a complete query builder.
4. **Expand parallel vendor qualification:** bring MySQL first-party protocol forward through comparative tests, then SQL Server, SQLite and model-native Redis where user tasks justify them. Do not call the historical MongoDB wrapper a native adapter.
5. **Professional application and lifecycle integration:** add Workbench and progressively qualify actual design/migration/admin workflows on top of the shared public technologies, using archived evidence where applicable.

This order is a **decision guide**, not a fixed date schedule, no promise of already delivered features and no reason to ignore the broader [product mission](PRODUCT.md).

## Platform capability expansion — an outcome-driven sequence

The eleven-phase professional lifecycle is not the full feature taxonomy. While native adapter qualification advances, independently plan and specify the developer technology **families** identified in [PRODUCT.md](PRODUCT.md), including:

- Relational ORM and model-native mapping contracts, identity, metadata, relationships and change tracking.
- Native-aware query builders, dialect handling, safe binding, compilation and query analysis.
- Schema design, generation, comparison, migrations, deployment and rollback.
- Administration, diagnostics, profiling, data movement, security, testing, automation and professional evidence.
- Cross-vendor concept/terminology mapping **later**, after both vendors' native capabilities and semantics are documented and tested.

Do not implement every capability at once. Prioritise professional/developer outcomes and prove each increment on real engines, then benchmark against relevant existing tools. Add a new library/application only when an independent public API and consumer scenario justify it. These are strategic directions, not announced delivery dates or support claims.

## Rules that prevent another sprawl

- Maximum one authoritative document per topic (see README index).
- No numbered “wave” modules, synthetic profile-count milestones or speculative adapters.
- No code-only task without a developer/professional outcome and acceptance test; no PostgreSQL or Shell demo may redefine the wider platform.
- Do not create a new registry when the documented support matrix can express the requirement.
- Use small PRs, test/verify, merge cleanly, preserve archived work without mixing legacy implementations into main.
- Record a decision when scope, architecture, priority or public API would change.
