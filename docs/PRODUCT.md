# NuBloxSQL — Product definition

**DRAFT — founder review, 18 October 2026.** This defines our intended product, not implemented capabilities.

## What is NuBloxSQL?

**NuBloxSQL is a proprietary, vendor-aware database technology platform built around a universal native database Driver, with professional Shell and Workbench applications that enable people to work across the entire database lifecycle.**

SQL is the NuBloxSQL brand, **not** a restriction to relational databases. Support is intended for both SQL and non-SQL models. Universal is the destination; qualified coverage must be evidenced engine by engine.

## Why does NuBloxSQL exist?

Database professionals and developers must currently use different drivers, editors, database administration tools, scripts and workflows for different vendors and environments. They lose time switching tools and terminology. NuBloxSQL aims to provide a **coherent, capable, secure and effective database technology ecosystem** while preserving the real differences between database products.

## The product family

| Product | What it is | Responsibility |
| --- | --- | --- |
| **NuBloxSQL Driver** | Independent first-party native programmable database foundation | Vendor-native connectivity and authentication; model-appropriate operations; safe parameters; types; transactions; metadata; streaming; cancellation; pooling; errors; capability negotiation |
| **NuBloxSQL Shell** | Professional command-line client and scripting application | Complete database work through published APIs; repeatable commands, automation and reviewable work products |
| **NuBloxSQL Workbench** | Professional graphical database application | Visual database design, development, administration, diagnosis, operations and guided lifecycle workflows using those same public APIs |
| **Developer technologies** | Independently usable optional libraries | Query builders, ORM or model-native mapping, parsing/compilation, migration and schema tooling where independently useful |
| **Lifecycle capabilities** | Database-scoped reusable task services | Technology selection, installation/provisioning integration, configuration, backup/restore, migration, upgrade, monitoring and retirement through authorised vendor/provider operations |

The Driver must not depend on Shell or Workbench, and applications must not implement rival private versions of its protocols. The Driver is the technical flagship; the **entire product** includes professional outcomes, not just connectivity.

## Who uses it?

- **Developers and database developers:** connect, query, build, test, deploy and maintain database-backed applications.
- **Database architects and designers:** model and compare schemas, choose technologies, plan data structures.
- **DBAs and operations teams:** install, configure, secure, diagnose, monitor, tune, back up, recover, upgrade and retire.
- **Data engineers and integration specialists:** import, export, validate, transform and migrate data.
- **Cloud, platform, reliability and security professionals:** handle identity, networks, policy, access, resilience and traceable evidence.

Job titles express needs, **not permissions**. All operations must respect database permissions, organisational policy and explicit operator intent.

## Entire database lifecycle

The Shell and Workbench are designed to serve these eleven connected stages. A completed workflow has defined inputs, authorised execution, clear outcomes, reliable errors/recovery and an appropriate work product.

| Stage | Required professional outcome |
| --- | --- |
| **1. Select** | Evaluate DBMS, workload needs and constraints |
| **2. Install** | Install or provision a supported database environment |
| **3. Initialize** | Initialise, configure and secure the target |
| **4. Discover** | Identify instances, schemas, objects, models, versions and capabilities |
| **5. Establish** | Configure and verify connections and sessions |
| **6. Build** | Design, create, test and maintain database objects and integrations |
| **7. Use** | Execute queries or model-native operations and manage data safely |
| **8. Understand** | Inspect, diagram, diagnose, explain, compare and profile |
| **9. Operate** | Administer, tune, monitor, maintain, back up, restore and recover |
| **10. Change** | Migrate, upgrade, deploy, review, roll back and verify changes |
| **11. Retire** | Export, decommission, revoke access and retain evidence |

## What universal means — four independent dimensions

1. **Database systems and models:** relational SQL, document, key-value, graph, wide-column, time-series, search, vector and multimodel databases.
2. **Native vendor fidelity:** actual protocol or embedded interface, product-specific queries and operations, dialects, types, transactions and native administrative behaviour.
3. **Deployment environments:** embedded/local, remote/self-hosted, containerised, private network, managed cloud and cloud-native services. Authentication, TLS identity, networking and cloud IAM combinations require separate qualification.
4. **Professional tasks:** a consistent developer and user experience across the database lifecycle, without pretending every vendor has the same capabilities.

**A list of vendors is not implementation.** A shared SQL interface is not support for non-SQL systems. Shared operations require proven semantic compatibility, and native vendor capabilities remain accessible. Cross-vendor translation is a separate, future capability and must clearly label lossy, emulated or unsupported semantics.

First-party native means NuBloxSQL authors its protocol/client behaviour, not a thin wrapper rebranding third-party database drivers. Runtime networking, operating-system crypto and embedded database engines may be used, with accurate attribution.

## What NuBloxSQL is NOT

- Not a database server or storage engine unless deliberately scoped separately.
- Not the NuBlox Enterprise Operating System, an ERP or a downstream application dependency.
- Not a generic cloud infrastructure control plane or uncontrolled installer.
- Not a lowest-common-denominator SQL translation layer that hides native differences.
- Not a product that claims universal vendor support or superiority without reproducible proof.

## What counts as finished?

For each **advertised release scope**, the following must all be demonstrably true:

1. Users can finish real end-to-end tasks through the declared public interface.
2. Live engine/version/security tests establish native functionality, types, auth, TLS, failures, privileges and recovery.
3. Every shipped library/application has a repeatable clean install, documented API, build, tests and support policy.
4. Driver, Shell and Workbench produce consistent outcomes where shared task support is advertised.
5. Resource safety, accessibility, correctness, security and relevant performance benchmarks meet explicit criteria.
6. The published support matrix distinguishes supported, experimental, limited and unsupported features.

An initial version may intentionally cover **few qualified vendors**, provided the workflows it advertises are complete and useful. Merged PRs and isolated protocol primitives are not finished product outcomes.

## Decisions before writing code

**Define the WHAT before designing the HOW.** On approval of this definition, decide the first complete user journey, supported engines/versions/models/deployments, release acceptance criteria and public contracts. Then review archives for selective reuse. Do not automatically resurrect earlier architecture, roadmaps or incomplete modules.
