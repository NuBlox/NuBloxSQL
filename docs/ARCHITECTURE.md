# Proposed architecture and first private implementation — not a released product

Design is **dependency directed**: tools consume the Driver's public API, which composes native database adapters. The architecture is a hypothesis until verified through a thin vertical implementation.

~~~text
NuBloxSQL Shell (CLI / REPL)    NuBloxSQL Workbench (SvelteKit)
            |                             |
            +-----> public Driver API <---+
                        |
            capability + policy boundary
                        |
       shared runtime contracts / resource lifecycle
                        |
       +----------------+----------------+
       |                |                |
   SQL adapters     document/kv/...   deployment/auth
   + dialects       native adapters   provider boundary
       |                |                |
  qualified DBMS     qualified DBMS   cloud/local target
~~~

## Separate axes — never conflate

1. **Data/query model:** relational SQL, document, key-value, graph, wide-column, time-series, search, vector, multimodel.
2. **Vendor and product:** a precise DBMS/version/edition, not merely a “dialect name”.
3. **Protocol/interface:** actual SQL wire protocol, document-native API, RESP, vendor API, etc.
4. **Deployment:** embedded/local, self-hosted, managed/cloud-native, via private endpoint or configured proxy.
5. **Capability qualification:** feature-level evidence, protocol correctness, authentication and live tests for that exact target.

A vendor catalogue is descriptive; it cannot route operations until an adapter exists. A managed service that speaks PostgreSQL may reuse a PostgreSQL wire adapter, but only after its actual TLS, authentication, endpoint and token-lifecycle combinations are validated.

## Product boundaries

- **Driver:** owns native adapters, operation contracts, metadata, resource control, errors, capability negotiation and explicitly database-scoped lifecycle primitives.
- **Shell:** owns commands, interactivity, human/machine output, scripting and task flows.
- **Workbench:** owns accessible UI, inspection, editing, guided operations and review/approval experiences.
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

## Quality gate

Implement one end-to-end driver-backed professional task first (real database → public API → Shell + Workbench → documented work product). Any additional infrastructure must support that task, have a qualification requirement and ship with evidence.
