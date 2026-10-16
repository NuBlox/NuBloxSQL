# Roadmap — gated, not date-driven

**The objective is an understandable, trustworthy product, not rapid file growth.** Do not begin implementation until the documentation gate is explicitly accepted.

## Stage 0 — preserve and simplify (this reset)

- [x] Capture the complete former implementation in a named archive ref.
- [x] Establish a clean docs-only default branch without legacy runtime/test/workflow clutter.
- [x] Define one product authority, traceable requirements, boundaries, task register and quality gates.
- [x] Catalogue 64 *candidate* professional activities, preserving archived provenance and marking scope limits.
- [ ] Review, split/merge and approve the candidate activities relevant to the first real-world task.
- [ ] Review the proposed baseline and decide the first product demonstration.
- [x] Apply GitHub branch/ruleset protection to both the default and archived refs (live GitHub API verified; optional owner CLI endpoint check remains in issue #328).

**Exit:** the product definition and initial task are confirmed, open design decisions are tracked, and a reviewer can explain the three products in one page.

## Stage 1 — specify one actual task end to end

**Accepted G0 engineering target:** [TASK-001](TASK-001.md), PostgreSQL 17 native catalogue inspection producing one versioned inventory through Driver, Shell and Workbench. Initial choices are documented; the release claims remain explicitly unqualified.

- [x] Resolve the [TASK-001 specification](TASK-001.md), [inventory JSON Schema](contracts/database-inventory-v1.schema.json) and [error schema](contracts/database-operation-error-v1.schema.json) into an accepted G0 engineering contract: PostgreSQL 17, bounded read-only queries, API/CLI naming, secret boundary and TLS policy.
- [x] Validate positive, partial and negative work-product examples in docs-only CI.
- [ ] Finish reproducible G1: commit generated npm lockfile, switch CI to `npm ci`, and digest-pin the PostgreSQL 17 fixture. Initial private Driver/Shell packages are under qualification.
- Define one typed Driver API request/result/error contract.
- Define credentials, TLS, privileges, timeouts, safe output, target identity and failure cases.
- Design Shell help/script output and Workbench user journey based on the same result schema.
- Choose test fixture versions and acceptance test scripts.
- Decide how to use the archived implementation without adopting its legacy structure.

**Exit:** reviewed requirements, schema examples, native conformance matrix and end-to-end acceptance scenarios. **No implementation code until this is approved.**

## Stage 2 — establish a small reproducible development toolchain

- Choose monorepo/workspace packaging and TypeScript build standards.
- Create only the Driver, Shell and Workbench structure needed for TASK-001 (initial Driver/Shell packages are present; Workbench will be added after qualified public API integration).
- Set up Node LTS, typechecking, linting, unit/security tests and first live database fixture.
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

## Rules that prevent another sprawl

- Maximum one authoritative document per topic (see README index).
- No numbered “wave” modules, synthetic profile-count milestones or speculative adapters.
- No code-only task without a professional outcome and acceptance test.
- Do not create a new registry when the documented support matrix can express the requirement.
- Use small PRs, test/verify, merge cleanly, preserve archived work without mixing legacy implementations into main.
- Record a decision when scope, architecture, priority or public API would change.
