# Proposed architecture and first private implementation — not a released product

**Platform scope is defined by [PRODUCT.md](PRODUCT.md), not by the size of today's executable slice.** The Driver is a foundational native technology within the larger platform; ORM, query builder, schema/migration and other independently consumable developer capabilities must not be misclassified as Shell/Workbench functionality or forced inside the Driver. Implementation dependency direction remains explicit, with native database adapters owned by NuBloxSQL.

~~~text
       Application developers             Database professionals
                  |                                |
   ORM / model APIs / query builders        Shell / Workbench
   schema & migrations / developer SDKs     design / operations / automation
                  |                                |
                  +------------+-------------------+
                               |
                  NuBloxSQL public capability APIs
                  metadata / query / policy / lifecycle
                               |
                 First-party native Driver foundation
                 protocol + identity + query semantics
                               |
              SQL and non-SQL model-native implementations
                               |
              Qualified DBMS / version / deployment targets

  Long-term interoperability: explicit vendor-aware translation/bridges,
  governed by native capability evidence and semantic-loss disclosure.
~~~

## Separate axes — never conflate

1. **Data/query model:** relational SQL, document, key-value, graph, wide-column, time-series, search, vector, multimodel.
2. **Vendor and product:** a precise DBMS/version/edition, not merely a “dialect name”.
3. **Protocol/interface:** actual SQL wire protocol, document-native API, RESP, vendor API, etc.
4. **Deployment:** embedded/local, self-hosted, managed/cloud-native, via private endpoint or configured proxy.
5. **Capability qualification:** feature-level evidence, protocol correctness, authentication and live tests for that exact target.

A vendor catalogue is descriptive; it cannot route operations until an adapter exists. A managed service that speaks PostgreSQL may reuse a PostgreSQL wire adapter, but only after its actual TLS, authentication, endpoint and token-lifecycle combinations are validated.

## Platform composition and boundaries

- **Native Driver foundation:** first-party protocols, DBMS sessions, authentication, native types, parameter binding, transactions, metadata, errors and capability contracts.
- **Developer technologies:** ORM (where relational semantics apply), model-native mappings, query builders, query processing, schema diff/migrations, SDKs, testing and development tools. They consume public Driver/native capabilities and are independently useful **without Shell or Workbench**.
- **Professional tooling:** Shell, Workbench and independently justified task services for the entire database lifecycle; command/UI experiences use shared public APIs and work products.
- **Interoperability:** a future optional semantic translation/compatibility layer above native adapters. It must declare when a cross-vendor operation is equivalent, emulated, lossy or unsupported. It must never silently misrepresent vendor behaviour.
- **Common platform services:** typed contracts, secure credential/profile resolution, durable jobs where needed, authorisation policy, audit and observability. Keep these distinct from vendor protocol adapters.
- **External boundaries:** authorised cloud identity, database provisioning or deployment providers; NuBloxSQL is not an arbitrary cloud account or generic infrastructure administrator.

The platform is **not constrained to a fixed number of libraries or applications**. Create new packages only when their public contracts and acceptance tests justify independent consumption, never as empty placeholders.

## First delivery slice — not the product boundary

The current private PostgreSQL read-only inventory Driver and Shell are the first verified experiment towards the larger platform. Missing ORM, query builder, Workbench, migration, other vendor and interoperability implementations remain explicit future work.

## Product boundaries

- **Driver:** owns native adapters, operation contracts, metadata, resource control, errors, capability negotiation and explicitly database-scoped lifecycle primitives.
- **Shell:** owns commands, interactivity, human/machine output, scripting and task flows; it does not own shared ORM, query builder or vendor semantics.
- **Workbench:** owns accessible UI, inspection, editing, guided operations and review/approval experiences; independent developer technologies are not tied to its lifecycle.
- **Providers:** constrained external mechanisms for identity, connection or database installation; no arbitrary cloud/host management inside the Driver.
- **Durable jobs:** shared application service for authorised database-specific work; job state is not a new database model or an excuse to embed orchestration in every adapter.

## Proposed structure after specification approval

~~~text
packages/
  driver/               Public JS/TS API and model-neutral contracts
  adapters/             Explicitly qualified native vendor adapters
apps/
  shell/                Independent CLI client
  workbench/            SvelteKit graphical client
docs/                   Authoritative specification and qualification
tests/                  Contracts + real DBMS integration/live matrices
~~~

The initial implementation contains `packages/driver` and `apps/shell` as **private TypeScript npm workspaces**, each compiled separately and connected through the Driver's public export. `apps/workbench` is planned, not present yet. The complete layout remains a **target architecture**, not an instruction to create empty directories. The former `pg` wrapper was a temporary implementation shortcut inconsistent with the accepted proprietary-first-party requirement. The active PostgreSQL adapter now uses **NuBloxSQL-owned protocol 3.0 framing, SCRAM challenge/response and extended query encoding** built on Node core sockets/crypto. It is initially loopback-only; remote verified TLS requires separate proof and qualification. The archive is not imported wholesale.

## Intellectual-property and dependency boundaries

NuBloxSQL's proprietary product identity is **not simply a matter of the licence text**. The implementation must genuinely own its reusable Driver API, native database communication protocols, adapter behaviour, credential/session/resource handling and SQL/non-SQL operation semantics.

- **First-party runtime:** NuBloxSQL-owned PostgreSQL, MySQL and other native vendor adapters (when implemented), transport framing, auth exchange implementations, errors, capability detection and query operations. No `pg`, `mysql2`, `tedious` or analogous driver may underpin a first-party adapter.
- **Permitted foundations:** Node.js built-in networking, TLS and cryptographic primitives and independently licensed development/build tooling (TypeScript, test runners). We are **not** claiming to own Node, TLS or the PostgreSQL open protocol standard.
- **Exceptions:** any future third-party client must be a clearly disclosed, explicitly optional compatibility layer, separately packaged, never described as a native NuBloxSQL protocol implementation and never included implicitly.
- **Evidence:** native wire-protocol integration tests against the actual DBMS, standard test vectors and negative security cases. Passing a mock-only test is not vendor qualification.
- **Intellectual-property hygiene:** write our own implementation using publicly available protocol specifications, maintain attribution and dependencies where required, and do not transplant third-party source code under the proprietary NuBloxSQL licence.

## API design rules

- No lowest-common-denominator fake SQL interface for non-SQL systems.
- Protocol-specific methods are presented under explicit typed namespaces.
- Portable operations exist only where semantics really align and limits can be disclosed.
- Connection contexts own timeouts, cancellation, authentication lifetime, cleanup and scoped privileges.
- Observability events have stable schema and avoid credential/statement leaks.
- Shell and Workbench never import private adapter/runtime paths.
- Cloud secret acquisition, tunnel creation and token refresh are explicitly contracted, not assumed.

## Archive-first engineering and clean-room product boundaries

The [archived asset assessment](ARCHIVE.md) is the **authoritative source-level reuse review**. Historical PostgreSQL protocol, session/TLS, MySQL framing/auth, SQL Server TDS, Redis RESP and AST/schema/migration modules must be examined before duplicate modules are implemented. Reuse is selective and requires independently valid current interfaces and tests, not a mass restoration of the old repository.

First-party means **we own the actual database communication implementation**, not merely that our source code calls a third-party native client. The archived MongoDB adapter loads the `mongodb` package's client and is not compatible with this requirement as a first-party wire adapter. By contrast, Node standard networking/TLS/crypto and built-in SQLite APIs are general-purpose/runtime facilities; they do not automatically represent third-party DBMS clients.

Archived test execution is an input to engineering qualification; real current vendor/version/auth/TLS/database tests and negative security review are still mandatory. Initial consolidation from the archive's PostgreSQL operation and result governance has been implemented **inside the existing private wire client**, with strict native result budgets, independent query deadlines and fail-closed session invalidation. See [archive assessment](ARCHIVE.md). This prevents both reinventing existing native modules and exaggerating legacy maturity.

## Avoid accidental scope narrowing

The first Driver → Shell → Workbench task is an **integration acceptance exercise**, not the complete NuBloxSQL product taxonomy. Develop model-aware libraries and services as specified, without duplicating core semantics inside UIs. Do not add third-party DBMS client drivers to first-party native adapters. Benchmark quality with realistic tasks and honest comparable evidence, not file counts.

## Quality gate

Implement one end-to-end driver-backed professional task first (real database → public API → Shell + Workbench → documented work product). Any additional infrastructure must support that task, have a qualification requirement and ship with evidence.
