# NuBloxSQL — Three Products, One Professional Database Lifecycle

**Authority:** [Product Blueprint](BLUEPRINT.md) is the authoritative product contract. This document explains its three product surfaces. [Product surface model](product-surface-model.json) is a small machine-readable companion. The [database profession work register](database-profession-work-register.json) is the canonical requirements input.

## 1. Three complementary products

| Product | Identity | Responsibility | Current state |
| --- | --- | --- | --- |
| **NuBloxSQL Driver** (`nubloxsql`) | Universal SQL **driver** and headless JavaScript/TypeScript API | Native connection drivers, dialect semantics, SQL execution, metadata, diagnostics, and reusable DBMS-specific lifecycle operations | Released npm package, four engine families with unequal qualification |
| **NuBloxSQL Shell** (`apps/shell/`) | Professional terminal tool | Interactive SQL, command scripts, automation, machine-readable work products, database lifecycle command workflows | Runnable source-tree CLI; full lifecycle commands incomplete |
| **NuBloxSQL Workbench** (`apps/workbench/`) | Professional graphical tool | Database explorer, editor, plans/reviews, graphical lifecycle workflows and evidence | Runnable local-only preview; full lifecycle experience incomplete |

Both professional tools consume the **public driver API**, not each other's implementation. The driver must not import a tool. No tool is permitted to reimplement native DBMS protocols or create its own incompatible dialect behavior.

**Universal** means a coherent extensible driver architecture across SQL engines, **not** that every dialect or feature already works. Today PostgreSQL, MySQL, SQLite and SQL Server are the executable focus. Each capability needs its own native support and test evidence.

The driver can expose headless lifecycle capabilities, including safe reusable plans and verification. The **user's task journey** (navigation, review, interactive approval, work-product composition, UI/session preferences, terminal output) belongs to Shell and Workbench. Shared domain semantics stay in the driver.

## 2. Design applications around database work, not job-title-specific screens

The profession work register is a requirements-discovery catalogue: **6 tracks, 18 families, 240 job-title entries (239 distinct titles), 40 activities and 11 phases**. Activities are divided into `governance` and `delivery`; they name the work to support, irrespective of the person's title.

Every activity should be traced as:

```text
Profession / career family (requirements lens)
            ↓
Database activity ID + governance/delivery responsibility
            ↓
Lifecycle phase + required capability + work product
            ↓
NuBloxSQL Driver public API, native safeguards and evidence
            ↓
NuBloxSQL Shell command / NuBloxSQL Workbench workflow
            ↓
Verified outcome, work product, limitations, audit evidence
```

Governance work covers standards, analysis, decisions, policy and authorization gates. Delivery work covers qualified execution, tests, recovery, validation and evidence. **A job title, career family or seniority is never an access-control or approval credential.** Actual privileges depend on trusted authenticated identity, target, action, approval and DBMS policy.

## 3. Whole-life coverage, with honest maturity

| Lifecycle phase | Example professional outcome | Shared driver foundation | Shell / Workbench experience target |
| --- | --- | --- | --- |
| Select | DBMS comparison and decision evidence | Registry, capabilities, support evidence | CLI comparison and visual selection |
| Install | Prerequisite and installation report | Host assessment and provider contracts | Plan, approve, execute, verify |
| Initialize | Initialized instance/cluster evidence | Engine-specific initialization primitives | First-run guided or scripted setup |
| Discover | Inventory of databases and schema | Native introspection | Search, browse and inspect |
| Establish | Configured database and access baseline | Bootstrap/configuration/security semantics | Controlled setup and evidence |
| Build | Verified schema and database objects | SQL, compiler, metadata | SQL editor, object design and commands |
| Use | Query results and data movement evidence | Queries, transactions, streaming | REPL, query grid and export |
| Understand | Diagnostics and impact findings | Explain, dependencies and intelligence | Analysis, reports and inspectors |
| Operate | Health, backup and recovery evidence | Engine-native operational primitives | Maintenance and recovery workflows |
| Change | Approved and verified migration | Diff, migration and upgrade capabilities | Plan, assess, apply, reconcile |
| Retire | Audited archive and decommissioning | Controlled retirement primitives | Destructive-action gates and reports |

**This table is target coverage, not a claim of implementation.** Consult the [Capability Register](CAPABILITY-REGISTER.md) for current maturity, with separate qualification for driver, Shell and Workbench. The register contains some non-relational, data governance, AI and BI professions; only their relevant database activities inform NuBloxSQL scope. This is not an HR system, ERP or generic AI product.

## 4. Development acceptance rule

Before accepting a major feature, record the linked activity ID(s), work products, governance/delivery distinction, lifecycle phase, public driver capability, native engine limitations, intended Shell and Workbench surfaces, safety/authorization boundaries and verification plan.

Incremental delivery is acceptable; the end state is **usable professional workflows**, not disconnected APIs or more SQL dialect names. If a tool needs missing database semantics, implement and qualify the driver capability first. Do not force unused UI into the driver.

The tools remain separate products with separate release qualification. Their public CLI and graphical workflows must be tested end to end, in addition to driver unit/dialect tests. A UI button or terminal command alone is not proof of a complete professional activity.
