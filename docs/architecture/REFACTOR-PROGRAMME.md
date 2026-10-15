# NuBloxSQL — Whole-Repository Refactoring Programme

**Status:** In progress. A repository-wide refactor is a sequence of independently
qualified changes, not a single mass rename. The public `nubloxsql` entry
point, SQL dialect contracts and release manifests are compatibility gates.

## North-star structure and ownership

```text
apps/
  shell/                 Terminal application: commands, REPL and automation
  workbench/             Graphical application: inspection, editing and workflows
lib/
  catalog/               Vendor/product/model and cloud deployment catalogues
  capabilities/          SQL-specific language, compiler, profiles and ontology
  client/
    administration/      Bootstrap and configuration planning/execution
    discovery/           Read-only server, security and scheduler inventory
    engineering/         Schema intelligence, migration and data movement
    runtime/               SQL result and prepared-value helpers
    [root integrations]   Public Client façade, connections, transactions, streaming
  core/                  Shared SQL core
  dialects/<engine>/     Native dialect, protocol, runtime and engine-local tests
  jobs/                  Internal durable orchestration and evidence
  lifecycle/             Pre-connect engine lifecycle and installation providers
  runtime/               Internal SQL routing and model-neutral adapter contracts
types/                   Public declaration surface (no UI dependencies)
test/                    Cross-cutting public, package and architecture tests
scripts/                 Release, build, qualification and maintenance tools
docs/                    Product, architecture, guides, cookbook and release contracts
```

NuBloxSQL Driver is a **universal database driver foundation**, not an
application or an SQL-only registry. The 100 relational SQL catalogue profiles
and non-SQL vendor/cloud reference records remain **descriptors**, not executable
drivers. Protocol adapters are qualified individually; cloud service placement
does not itself implement IAM, authentication, tunnelling or provider APIs.

## Refactoring work register

| Scope | Status | Required completion evidence |
| --- | --- | --- |
| Products and public boundaries | Defined | Blueprint and three-product release gate |
| Driver read-only discovery | Server/security/jobs grouped; MySQL security metadata and SQL Server metadata integrations additionally grouped | Public API and discovery boundary tests, legacy path rejection |
| Vendor and cloud catalogues | Grouped in `lib/catalog/` | Registry validation, non-routable vendor assertions, packaged type/API surface |
| Bootstrap and configuration | Grouped in `lib/client/administration/` | Plan integrity, execution contracts and release manifests |
| Schema/migrations/data movement | Grouped in `lib/client/engineering/` | SQL metadata, migration and data movement contracts, packed consumers |
| SQL connection adapter routing | Extracted into `lib/runtime/SqlAdapterRouter.js` | Alias/URL/error parity, lazy imports, packed client and four dialect runtime tests |
| Model-neutral native adapter declaration | Internal contract implemented | Contract tests; non-SQL catalogue entries remain non-routable |
| Native adapter registry and loader safety | Immutable internal registry wired to SQL router | Duplicate-ID rejection, operation gating, lazy cache, no public registration, no non-SQL runtime claims |
| Connection/transaction/stream/error integrations | Partially complete: routing and SQL result/binding helpers extracted; remaining Client lifecycle/transaction/stream/error policies | Native engine regression matrix and unchanged public `Client` |
| SQL compiler/parser pipeline (`lib/capabilities/`) | DDL and DML modules grouped by semantic responsibility; AST/query-core regrouping remains | Stable AST and per-dialect compiler regression tests, moved-module packed manifest |
| DBMS adapters (`lib/dialects/`) | Preserve native isolation | Live MySQL/PostgreSQL/SQLite/SQL Server CI and version evidence |
| Durable job kernel and lifecycle | Preserve, harden progressively | Job safety, approval, replay and lifecycle checks |
| Shell command families | Remaining | Shell public-API-only dependency check and actual command execution tests |
| Workbench feature areas | Remaining | Workbench local runtime and HTTP acceptance suite |
| Tests and release tooling | SQL DDL/DML package qualifiers grouped under `scripts/release/`; 22 AST tests under `test/sql/ast/`; 19 live compiler tests under `test/sql/integration/`; remaining cross-cutting tests ungrouped | Release/platform suites, Tier-1 evidence, vendor CI triggers/commands, import boundaries, Node 22/24/26 |
| Documentation/technology references | Continuous | No stale internal paths in authoritative release evidence |

Status means only the **structural location is updated**, not that the
business/technical capability is complete. The user-facing database lifecycle
still has gaps. Do not delete unused-looking source or any test solely
because it is not referenced by a current interface; evaluate release,
security, vendor and archival evidence first.

## Required rules for every subsequent increment

1. Inspect current `main`, remote branches, open PRs, instructions and all
   relevant import/release evidence before editing; preserve other work.
2. Name a bounded, coherent responsibility and its old/new paths.
3. Keep all public `index.js` exports, `Client` methods, TypeScript types
   and package entry points unchanged unless a versioned breaking change is
   separately approved.
4. Resolve moved relative CommonJS imports and vendor adapters **without
   duplicating** implementations through compatibility stubs.
5. Update `docs/releases/public-api-v1.json`,
   `docs/releases/tier1-stable-evidence.json`, package include rules,
   product coverage, direct tests and operational documentation together.
6. Enforce dependency direction:
   `apps/* → public driver`, `driver → native adapters`,
   `catalog → capability descriptions` and **never**
   `driver → apps/*`. Native query models remain engine-specific.
7. Run `npm run test:platform`, `npm run verify:release`,
   `npm run release:qualify`, `npm pack --dry-run`, supported
   vendor CI and application suites when affected.
8. Merge only after checks pass, then verify `main`, branch cleanup,
   the npm package and post-merge checks.

## Recommended next owned units

- **Shared connection runtime:** isolate URL parsing, pool lifecycle,
  transaction and cancellation integrations without changing routing.
- **SQL language pipeline:** group parser, model, AST, DML and DDL code by
  semantic responsibility, not implementation wave number; preserve all
  existing SQL dialect compile behaviour.
- **Vendor adapters:** establish a native adapter contract and real cloud
  connectivity qualification matrix before promoting extra catalogue entries.
- **Shell and Workbench:** organize commands/views around the 40 professional
  activities, eleven lifecycle phases and the work products needed by actual
  database professionals.

**Never call the entire repository refactor complete** until these remaining
areas have independent validation and the resulting layout is consistently
documented and enforced. 
