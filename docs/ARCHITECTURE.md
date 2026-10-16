# Proposed architecture — no implementation yet

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

This is a **target layout**, not a request to create empty folders. Package boundaries and publication strategy must be decided before adding files. Native implementation can be reused from the archived version only after tests prove the new contracts.

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
