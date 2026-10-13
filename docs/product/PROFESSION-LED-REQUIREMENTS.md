# Database Profession-Led Work Requirements

**Status:** Product-design input, not a public NuBloxSQL API, implemented profession module, authorization model or claim of functionality.

**Canonical machine-readable source:** [Database profession work register](database-profession-work-register.json).

## Decision

Use the supplied **18 career-family** catalogue as a requirements-discovery lens for **NuBloxSQL Driver, NuBloxSQL Shell and NuBloxSQL Workbench**. Model what professionals need to accomplish, which database-specific driver API powers the task, what Shell and Workbench must expose, and which verifiable work product is produced. Do not turn job titles into SQL grants, database roles, employment records, human-capital-management features or a dependency of the **driver** on either tool or another product.

The register currently contains:

- 6 thematic tracks and 18 illustrative career families;
- 240 title-to-family entries (239 distinct titles; *Data Warehouse Architect* legitimately appears in two families);
- 40 normalized database-work activities, each attributed to an accountable **governance** or executing **delivery** workstream;
- 13 competency areas, seven optional seniority facets, named work products and traceable links to existing NuBloxSQL capability-register areas;
- the blueprint's **8 product domains** and **11 lifecycle phases**;
- 4 current executable database-engine focuses and 14 additional **reference-only** technology specializations.

This is a curated starting taxonomy based on user-provided professional labels, **not** a claim that all job titles are formally recognized occupations or that the 40 activity maps are exhaustive. Actual operating models often allocate more than one activity to a position, and the same activity can be performed by multiple professions.

## Canonical separations

| Concept | Definition | Consequence |
| --- | --- | --- |
| Career family | A grouping of related professional responsibilities and skills | A classification aid, not a runtime role |
| Job title | A human-readable label that may overlap other families | No entitlement is conferred by the label |
| Seniority facet | Entry, practitioner, senior, lead, principal, head or executive | A workforce-description attribute, not an approval right |
| Competency | Knowledge/skill dimension associated with an activity | Training and capability assessment input |
| Workstream | **Governance** sets standards, policy and decision criteria; **delivery** executes database work | Every activity has a workstream, independent of job title |
| Database activity | An intentional unit of work such as inspect host, restore backup or test migration | The durable design unit for requirements |
| Work product | Evidence or output such as an installation plan, schema snapshot or restore report | Testable definition of completion |
| Product capability | A NuBloxSQL function needed to support an activity | Maps to the existing [capability register](CAPABILITY-REGISTER.md), where maturity is assessed |
| Lifecycle phase | Select → Install → Initialize → Discover → Establish → Build → Use → Understand → Operate → Change → Retire | Explains *when* the work happens; not a folder or organization unit |
| Technology specialization | Experience with a particular DBMS or workload | Does not imply NuBloxSQL runtime support |

**Access-control boundary:** authentication, privileges, approval policy and segregation of duties must be validated against the actual authenticated principal, target and requested action. A job's title, family, seniority or competency must *never* be accepted as sufficient authority to execute a privileged database operation.

**Product boundary:** NuBloxSQL provides the database-specific primitives and engine-honest semantics. Enterprise career management, hiring, organization structures, generic training systems, analytics dashboards, broad AI tooling and generic cloud infrastructure are **not** new NuBloxSQL product domains. A downstream interface may consume this requirements taxonomy but must not become a dependency of the core package.

## Three-product delivery traceability

The register specifies the work of database professions; the universal SQL
**driver** provides shared semantics, while **Shell** and **Workbench** are
two different ways to complete that work.

| Work dimension | NuBloxSQL Driver | NuBloxSQL Shell | NuBloxSQL Workbench |
| --- | --- | --- | --- |
| Database capability | Qualified public operation and native semantics | Invoke and compose commands | Invoke via guided UI |
| Governance | Policy and evidence primitives | Inspect, compare, report | Visual assessment, review and approval |
| Delivery | Controlled native execution and verification | Scripted/interactive execution | Guided execution and verification |
| Work product | Typed result, plan or report | Machine-readable or human-readable output | Contextual view, record and export |

An activity can serve multiple roles without duplicating driver logic or
permissions. A career title never grants access; authorization must use a
trusted identity, target, action and DBMS policy. **A UI button or command
alone does not constitute a delivered activity.** See [Product Surfaces](PRODUCT-SURFACES.md).
The register's requirements must not be presented as 40 implemented workflows.

## Family-to-work traceability

The JSON register lists every submitted title within its applicable family. Families reference normalized activity IDs rather than embedding duplicated workflows.

| ID | Family | Illustrative database work supported by the mapping |
| --- | --- | --- |
| 01 | Database leadership and management | Engine selection, service standards, policy, continuity and retirement authorization |
| 02 | Database architecture and design | Physical/logical modeling, schema impact, capacity and upgrade design |
| 03 | Database engineering and development | Schema authoring, SQL execution, migration and testing |
| 04 | Database administration | Instance discovery, bootstrap, configuration, security, operational care and decommission |
| 05 | Installation, provisioning and configuration | Host prerequisites, engine provisioning, initialization and baseline creation |
| 06 | Performance, capacity and reliability | Query plans, sessions, health, storage growth and high availability |
| 07 | Backup, recovery and business continuity | Backup policy, verification, restore testing and replication readiness |
| 08 | Database support and service operations | Diagnostics, incident investigation, maintenance and operational documentation |
| 09 | Database security | Security policy, principals, privilege change and audit evidence |
| 10 | Data governance and information management | Data policies, metadata, lineage, quality and lifecycle retention |
| 11 | Data engineering and integration | Data mapping, transfer, change capture and reconciliation |
| 12 | Data warehousing and business intelligence | Database modeling, ingestion and trustworthy analytical datasets |
| 13 | Distributed, non-relational and emerging databases | Specialized workload/engine suitability assessments and database-relevant semantics |
| 14 | Artificial intelligence and machine learning data systems | Database-side retrieval contracts, data validation and storage integration |
| 15 | Database testing and quality assurance | Schema, data, migration, security and performance test evidence |
| 16 | Database migration, modernisation and retirement | Change plans, upgrade decisions, cutover verification and archive/retire evidence |
| 17 | Database products, research and innovation | Driver/protocol, SQL compiler, engine capabilities and technical specifications |
| 18 | Consultancy, advisory and specialist delivery | Client assessment, risk and selection recommendations, and technical handover |

## Example: how requirements become complete work

**Example persona: Database Administrator** (family-04). A real project can link their activities into the lifecycle, irrespective of how that person is employed:

| Stage | Activity ID | Work product | NuBloxSQL capability area |
| --- | --- | --- | --- |
| Select / Install | `a06`, `a07` | Host inspection and installation plan | Engine selection / installation |
| Install / Initialize | `a08` | Installation and readiness verification | Runtime / cluster initialization |
| Discover / Establish | `a09`, `a10` | Server inventory and bootstrap evidence | Metadata/introspection; Database bootstrap / initial setup |
| Establish / Operate | `a11`, `a13` | Configuration baseline and access-change audit | Database/server configuration; Security administration |
| Understand / Operate | `a17`, `a18` | Health snapshot and execution-plan analysis | Operational health / sessions; Query diagnostics |
| Operate | `a14`–`a16` | Recovery objectives, backup manifest and restoration test | Backup / restore / recovery |
| Change | `a28`, `a29` | Upgrade assessment and post-upgrade verification | Upgrade readiness; Engine/runtime upgrade |
| Retire | `a30`, `a31` | Authorized retirement and verified disposition | Retirement |

**Important:** this is the required end-to-end professional experience, **not** an assertion that the full chain is implemented. The present [capability register](CAPABILITY-REGISTER.md) reports material gaps, including security administration, backup and restore, engine upgrades and retirement.

### Example: role and activity reuse

A Database Architect (family-02) and Database Migration Engineer (family-16) can both use schema impact work (`a25`), but one may **govern** the accepted design and the other may **deliver** and verify the migration (`a26`). These are independent responsibilities with separate authorization/approval requirements. The catalogue does not require a worker to hold a specific job title for an activity to be available through the public API.

A DBMS Software Engineer (family-17) requires database protocol and compiler tools (`a34`/`a40`); these are **NuBloxSQL development capabilities**, not promises that the package will expose an IDE, code-hosting service or product management suite.

## Prioritization: use actual maturity, not wishful coverage

The family catalogue increases the visibility of missing lifecycle steps. It does **not** reorder the frozen [roadmap](ROADMAP.md) without an explicit product decision:

| Professional outcome | Current maturity from capability register | Product implication |
| --- | --- | --- |
| Inspect host and plan database installation | Partial | Qualify concrete installation and initialization providers |
| Establish principals, access controls and audit | Gap in security administration | Build engine-honest security administration interfaces |
| See health, sessions and ongoing work | Partial | Complete shared operational discovery/diagnostics |
| Back up, restore and prove recoverability | Gap | Establish first-class backup/recovery contracts and engine-native verification |
| Make a versioned schema change safely | Established foundation | Strengthen tests and live qualification, then integrate durable execution gates |
| Evaluate upgrades and retirement | Gap | Deliver readiness, policy, backup gates and proven disposal |
| Coordinate durable jobs | Partial, internal only | Qualify workflows and mutation fencing before exposing automation publicly |

## Runtime and specialism boundaries

The current implementation focus remains **PostgreSQL, MySQL, SQLite and SQL Server**, each with its own qualified coverage and limitations. Oracle, MariaDB, Db2, MongoDB, Cassandra, Neo4j, Redis, Snowflake, Amazon Aurora/RDS, Azure SQL, Spanner, SAP HANA, Elasticsearch and InfluxDB are **career-specialization references only** in this register. The presence of an example role for one of these systems must not increase published support claims.

The broader taxonomy includes non-relational/AI occupations because professionals may work across systems. NuBloxSQL's core stays specific to the database semantics defined in the [blueprint](BLUEPRINT.md). It must not expand its supported engines, ORM/ERP surface or external-platform dependencies merely to satisfy every career label.

## How to extend the register

1. Add/adjust a family or title only when it improves requirements discovery. Keep a stable family ID and preserve cross-family overlaps where they are real.
2. Normalize required work into a reusable activity (e.g. `a16` Restore and rehearse disaster recovery), with explicit governance/delivery, lifecycle phases, relevant product domains, work products, competencies and **exact capability-register area names**.
3. Check product maturity **in the existing register** rather than duplicating statuses in JSON. Avoid false assertions that a gap has been delivered.
4. Qualify implementation against real engine behavior, workflow safety, evidence and tests before labelling the requirement complete.
5. Run `node test/profession-work-register.js` and `npm run test:platform`. The test enforces reference integrity, capability-area naming and engine-scope boundaries.

The canonical product remains the stand-alone `nubloxsql` JavaScript/TypeScript package, with its existing **eight domains, eleven lifecycle phases and three execution levels** (operation, job, workflow). This career-led map is a requirements input, not an alternative architecture.

## External references and methodology

- [Government Digital and Data Profession Capability Framework](https://understand-digital-data-roles-skills.service.gov.uk/) — role and role-level skills model, including [data engineer](https://understand-digital-data-roles-skills.service.gov.uk/role/data-engineer/) and [data architect](https://understand-digital-data-roles-skills.service.gov.uk/role/data-architect/) examples.
- [O*NET Database Administrators 15-1242.00](https://www.onetonline.org/link/summary/15-1242.00) — occupational tasks, knowledge and skill dimensions.

These sources **inform the mapping method**; neither source independently validates all 240 supplied titles or NuBloxSQL's proposed family/activity classifications. Descriptions and work-product mappings here are original project design inputs, not transcribed government role definitions.
