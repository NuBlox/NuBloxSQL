# Database careers and job roles — authoritative reference taxonomy

**Status:** User-supplied requirements discovery input, 16 October 2026. **Not** implemented user roles, access-control policy or evidence of database support.

The [machine-readable careers catalogue](data/database-careers.json) is the **single canonical list of every job title**, grouped by career family. It preserves the 18 provided career families and all 240 entries in the supplied order. This document explains how the careers inform NuBloxSQL product requirements; it is not a second job-title register.

## Coverage summary

| Group | Career group | Families | Role entries |
| --- | --- | ---: | ---: |
| A | Database strategy, architecture and engineering | 3 | 45 |
| B | Database administration and operational services | 5 | 56 |
| C | Security, governance and regulatory compliance | 2 | 28 |
| D | Data movement, analytics and intelligence | 2 | 31 |
| E | Specialist database technologies | 2 | 25 |
| F | Database change, quality and lifecycle management | 4 | 55 |
| **Total** | | **18** | **240** |

**239 unique titles:** “Data Warehouse Architect” legitimately appears in both database architecture/design and data warehousing/business intelligence. Do not remove that overlap or inflate unique counts.

## The 18 career families

| No. | Career family | Job-title entries |
| ---: | --- | ---: |
| 01 | Database leadership and management | 14 |
| 02 | Database architecture and design | 16 |
| 03 | Database engineering and development | 15 |
| 04 | Database administration | 14 |
| 05 | Installation, provisioning and configuration | 11 |
| 06 | Performance, capacity and reliability | 12 |
| 07 | Backup, recovery and business continuity | 9 |
| 08 | Database support and service operations | 10 |
| 09 | Database security | 11 |
| 10 | Data governance and information management | 17 |
| 11 | Data engineering and integration | 15 |
| 12 | Data warehousing and business intelligence | 16 |
| 13 | Distributed, non-relational and emerging databases | 14 |
| 14 | Artificial intelligence and machine learning data systems | 11 |
| 15 | Database testing and quality assurance | 12 |
| 16 | Database migration, modernisation and retirement | 14 |
| 17 | Database products, research and innovation | 16 |
| 18 | Consultancy, advisory and specialist delivery | 13 |

All individual role names (including leadership, administrators, security, ETL/BI, AI and DBMS research specialties) live only in [data/database-careers.json](data/database-careers.json).

## Vendor and technology specialisations

These examples modify a profession rather than create additional career families. They also **do not indicate that a vendor is supported by a NuBloxSQL driver**; release support is governed solely by [Support and qualification](SUPPORT-AND-QUALIFICATION.md).

| Technology specialisation | Example role |
| --- | --- |
| MySQL | MySQL Database Administrator |
| PostgreSQL | PostgreSQL Database Engineer |
| Oracle Database | Oracle DBA / PL/SQL Developer |
| Microsoft SQL Server | SQL Server DBA / T-SQL Developer |
| MariaDB | MariaDB Database Administrator |
| IBM Db2 | Db2 Database Administrator |
| SQLite | Embedded Database Developer |
| MongoDB | MongoDB Database Engineer |
| Apache Cassandra | Cassandra Database Engineer |
| Neo4j | Graph Database Engineer |
| Redis | Redis Database Engineer |
| Snowflake | Snowflake Data Engineer |
| Amazon Aurora / RDS | AWS Database Engineer |
| Azure SQL | Azure Database Administrator |
| Google Cloud Spanner | Distributed Database Engineer |
| SAP HANA | SAP HANA Database Administrator |
| Elasticsearch | Search Platform Engineer |
| InfluxDB | Time-Series Database Engineer |

## How this changes what NuBloxSQL must deliver

The professions are a **who-does-the-work taxonomy**. They inform, but do not replace, the **what-work-is-done register** in [WORK-REGISTER.md](WORK-REGISTER.md). The eleven lifecycle phases tell us **when**; database models and vendors tell us **where/how**; the relevant NuBloxSQL platform capability (Driver, ORM, query builder, SDK, Shell, Workbench or another justified tool) tells us **how the outcome is delivered**.

| Professional constituency | Database-scoped capability and work products to investigate |
| --- | --- |
| Leadership, architects and consultancy (families 01–03, 18) | Technology choices, schema design, compatibility evidence, technical assessments and reviewable decisions |
| DBAs, deployment and reliability (04–08) | Connection, installation/initialisation, configuration, monitoring, capacity, incidents, recovery and retirement |
| Security and governance (09–10) | Native users/privileges, database access evidence, auditing, retention metadata, traceability and exportable policies |
| Integration, data engineering, BI (11–12) | Native queries, movement, import/export, schema/lineage evidence and bounded database-facing transformations |
| Non-relational, distributed and AI data platforms (13–14) | Model-native database operations, graph/vector/document interfaces, capability negotiation, indexing/search primitives |
| QA, migration and DBMS product engineering (15–17) | Test fixtures, workload diagnostics, change/rollback, native protocol conformance, driver contracts and implementation evidence |

**Scope guard:** An occupation can have duties outside databases. Building dashboards, training ML models, running arbitrary ETL platforms, provisioning whole cloud accounts or administering corporate governance is not automatically a Driver requirement. NuBloxSQL may expose database-native primitives and evidence for those tasks, and Shell/Workbench may offer suitable database-centric workflows, but downstream platforms remain separate.

## Operational mapping rule

For each proposed activity, trace:
`career-family ID → developer/professional task ID → governance/delivery activity → lifecycle phase → work-product schema → native DBMS/model capabilities → relevant NuBloxSQL capability API (Driver, ORM, query builder, migration, etc.) → applicable Shell/Workbench journey → real-engine acceptance test`.

Do not infer permissions or approvals from job title, seniority or family. Those require trustworthy user identity, target-specific privileges, risk policy and authorisation evidence.

## Follow-up review

The [work register](WORK-REGISTER.md) now separates 40 *unreviewed* archived activities and 24 new gap candidates, with traceability to these families and expected database work products. They are not approved product requirements until reviewed and accepted. Original data: [legacy profession register](https://github.com/NuBlox/NuBloxSQL/blob/archive/legacy-implementation-2026-10-16/docs/product/database-profession-work-register.json).
