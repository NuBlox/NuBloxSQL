# NuBloxSQL Roadmap

## Mission

Build NuBloxSQL into the preferred **single-entry SQL database integration platform for developers**: one installation, one import, one coherent API, multiple first-class SQL dialects.

The roadmap advances two things together:

1. **public platform maturity** — the quality of the one-entry developer API, capability model and shared contracts;
2. **native runtime depth** — how completely each database dialect is implemented and qualified.

A dialect is not complete merely because it can execute `SELECT 1`, and NuBloxSQL is not complete merely because a capability descriptor says the database engine supports a feature.

## Public platform target

```bash
npm install nubloxsql
```

```js
const sql = require('nubloxsql');
const db = sql.createConnection({ dialect: 'postgresql', ...config });
```

Developers should not need a separate third-party driver package for each supported dialect, while still retaining access to engine-native power where portability would be misleading.

## Current dialect programme

| Dialect | Product tier | Current state | Runtime model |
| --- | --- | --- | --- |
| PostgreSQL | Tier 1 | Current P0 world-class runtime-depth gate complete; P1/P2 depth continues | Native client/server runtime |
| MySQL | Tier 1 | Current P0 world-class runtime-depth gate complete; P1/P2 depth continues | Native client/server runtime |
| SQLite | Tier 1 | Deep implementation; production/stable qualification is the active P0 wave | Embedded runtime |
| SQL Server | Tier 2 | Production-supported native implementation; maintained while Tier-1 work is prioritised | Native client/server runtime |
| Oracle | Planned | Not implemented | Native client/server runtime |

The authoritative Tier-1 development register is `docs/architecture/tier1-world-class-gap-audit.md`.

## Phase 0 — Stable native baseline — complete

The stable baseline established:

- SQL Core contract family `1.0`;
- native MySQL and PostgreSQL runtimes;
- zero-third-party npm package boundary for stable runtime implementation;
- Node.js 22/24/26 verification;
- MySQL 8.4/9.7 live qualification;
- PostgreSQL 15/16/17/18 live qualification;
- proprietary release gates, fuzzing and CodeQL.

## Phase 1 — Single-entry NuBloxSQL facade — complete

The root `nubloxsql` package is the canonical public product.

Completed facade work includes:

- one install and one import;
- explicit dialect and connection-URL routing;
- `createConnection(...)`, `createPool(...)` and `createClient(...)` routing where supported;
- consistent lifecycle/configuration/error contracts;
- capability and descriptor discovery;
- public metadata/introspection;
- portable transaction policy;
- observability conventions;
- TypeScript dialect discrimination;
- stable release qualification and packed-consumer tests.

The release contract is machine-enforced through `docs/releases/public-api-v1.json` and `npm run release:qualify`.

## Phase 2 — SQL capability intelligence — foundation complete

NuBloxSQL now has exhaustive-v1 semantic models for PostgreSQL, MySQL and SQLite across the shared capability taxonomy.

Completed capability programme:

1. core SQL capability schema;
2. PostgreSQL exhaustive-v1 map;
3. MySQL exhaustive-v1 map;
4. SQLite exhaustive-v1 map;
5. cross-dialect matrices and directional compatibility analysis;
6. live/version-aware runtime qualification;
7. guarded rewrite policy and safe parameter-marker translation;
8. conservative SELECT AST/parser/compiler foundation.

The compiler foundation remains regression-tested, but **grammar expansion is paused while Tier-1 runtime-depth P0 gaps are closed**. NuBloxSQL will not become world-class by modelling syntax faster than it implements and qualifies the underlying engines.

## Phase 3 — Tier-1 world-class runtime depth — active

### Wave 1 — PostgreSQL native workflows — current P0 complete

1. ~~COPY FROM STDIN~~ — **qualified**
2. ~~COPY TO STDOUT~~ — **qualified**
3. ~~LISTEN/NOTIFY~~ — **qualified**
4. ~~structured EXPLAIN / EXPLAIN ANALYZE~~ — **qualified**
5. ~~deep catalog introspection~~ — **qualified**

PostgreSQL can now progress through high-value P1/P2 depth—native type fidelity, prepared-statement/cache policy, server diagnostics and logical-replication foundations—without reopening the completed current P0 gate.

### Wave 2 — MySQL native workflows — current P0 complete

1. ~~LOAD DATA LOCAL INFILE with explicit security policy~~ — **qualified**
2. ~~structured EXPLAIN / EXPLAIN ANALYZE~~ — **qualified**
3. ~~deep INFORMATION_SCHEMA / Performance Schema metadata~~ — **qualified**
4. ~~authentication-plugin support-matrix closure~~ — **qualified**

MySQL now has the current P0 runtime-depth baseline: secure bulk import, structured native query diagnostics, deep engine/security metadata, and a version-aware authentication-plugin matrix qualified on MySQL 8.4 and 9.7.

The authentication matrix treats `caching_sha2_password` as the preferred modern path, supports deprecated `sha256_password` over TLS/RSA for migration compatibility, retains honest legacy client handling for `mysql_native_password`, and guards cleartext-plugin use behind TLS plus explicit opt-in.

Future MySQL work is P1/P2 unless a new baseline requirement or regression is identified. High-value candidates include protocol compression, server/session diagnostics, multi-result/stored-program depth, JSON/spatial fidelity and optional binlog/replication foundations.

### Wave 3 — SQLite stable qualification — active P0

SQLite feature breadth is no longer the main blocker. The remaining P0 work is operational evidence:

1. repeatable performance benchmarks;
2. memory qualification and regression ceilings;
3. WAL/rollback-journal concurrency stress;
4. malformed/corrupt schema/input hardening;
5. backup and changeset stress/failure recovery.

SQLite moves from Development to Stable only after this production qualification is complete.

### Wave 4 — Shared Tier-1 evidence

- richer metadata/introspection vocabulary proven across all three Tier-1 dialects;
- cross-dialect EXPLAIN/diagnostics entry point with native payload retention;
- reproducible benchmark harness;
- explicit failure/adversarial matrix;
- per-dialect stable evidence register linking claims to tests/workflows/docs;
- final documentation and release-contract reconciliation.

## Phase 4 — SQL compiler expansion — deferred until Tier-1 P0 closure

The AST/parser/compiler foundation is retained and tested. Once Tier-1 runtime depth is at the required quality bar, expansion can resume in a controlled order:

1. CTEs and recursive CTEs;
2. subqueries and derived tables;
3. set operations;
4. CASE/CAST and richer expressions;
5. window specifications;
6. INSERT;
7. UPDATE/DELETE;
8. UPSERT/RETURNING;
9. DDL AST;
10. vendor-specific semantic transformations.

No transformation is considered safe merely because the output SQL parses. Capability and semantic evidence remain mandatory.

## Phase 5 — Broader dialect programme

SQL Server remains supported and regression-gated as Tier 2 while the Tier-1 programme is active. After the Tier-1 quality bar is achieved, decide whether to promote SQL Server into the same exhaustive runtime-depth programme before beginning Oracle.

Potential later engines include Oracle, MariaDB, CockroachDB, DB2, Snowflake, BigQuery, ClickHouse and other SQL-family systems. No support claim exists until a runtime is implemented, integrated into the root package and qualified.

## Quality bar for a world-class Tier-1 dialect

A world-class Tier-1 dialect must demonstrate:

- correct lifecycle behaviour;
- secure authentication/transport where applicable;
- prepared execution and deterministic bind semantics;
- transaction/savepoint correctness;
- explicit cancellation/deadline semantics;
- streaming/backpressure where applicable;
- resource limits and deterministic cleanup;
- deep metadata/introspection appropriate to the engine;
- high-fidelity native type handling;
- structured errors and native diagnostics;
- observability;
- engine-native bulk/data-movement workflows where material;
- engine-native administration/diagnostics where material;
- multi-version live qualification;
- failure-path/security/adversarial testing;
- reproducible performance and memory evidence;
- explicit static and runtime capability metadata;
- native extension access without polluting portable contracts;
- proprietary-source/release-boundary compliance.

## Product-level success condition

NuBloxSQL succeeds when a developer can choose it as their **single SQL integration dependency** for PostgreSQL, MySQL and SQLite and receive both:

1. a coherent, dependable common API; and
2. first-class access to the capabilities that make each engine distinct.

Only after that foundation is exceptional should NuBloxSQL broaden dialect count or aggressively expand automatic SQL transpilation.
