# NuBloxSQL Driver — universal native architecture blueprint

**Status:** engineering design proposal, 18 October 2026; pending founder approval. **Not implemented.** This document defines an actionable technical direction for the Driver only. The authoritative description of the product and its outcomes remains [PRODUCT.md](PRODUCT.md). This blueprint must not expand or redefine the product.

## 1. Outcome, not a collection of modules

The **NuBloxSQL Driver** is a first-party, independently usable database access library. A developer should be able to open an authenticated connection to a supported real database, discover what it can do, safely perform native operations, receive correct typed results and reliable errors, and close all resources. Shell, Workbench, ORM and query builders are **separate clients or libraries** using public Driver contracts.

**Universal** means one coherent developer experience across multiple **native database providers**, *not* that every provider has the same wire protocol, SQL dialect, types or data model. The Driver must maintain native fidelity and explicitly disclose portability limits.

We will develop **NuBloxSQL-owned implementations** of native protocol behaviour, not rebrand a dependency on another database driver. Generic runtimes, sockets, TLS, crypto and documented embedded-engine interfaces may be used. Implementation language, binary acceleration and packaging remain design decisions to be validated, not product promises.

## 2. Three axes: vendor, model and deployment

A **vendor/engine** identifies a particular DBMS implementation (e.g. MySQL, PostgreSQL, SQLite, Microsoft SQL Server). A **data model** identifies the operations and semantics of relational, document, key-value, graph or other interfaces. A **deployment profile** describes embedded, TCP/TLS, local socket, self-hosted, managed cloud or other connection paths.

These axes must not be conflated:

- **Vendor ≠ SQL dialect.** A vendor module owns native connectivity and type semantics; a SQL dialect module, where applicable, is one subordinate aspect.
- **Cloud service ≠ automatically a new dialect.** Deployment, authentication and service-specific features may warrant an explicit profile or an independent adapter, based on real technical differences.
- **Protocol family ≠ vendor equivalence.** Vendors that share parts of a wire protocol can reuse qualified protocol primitives without being treated as interchangeable.
- **Non-SQL ≠ SQL emulation.** Model-native session operations are separately typed and versioned; SQL may be added only where the target actually supports it.

A target is only called supported when its precise **vendor, version, model, transport, authentication method and qualified capability set** have live test evidence.

## 3. Layer boundaries

| Layer | Owns | Must not own |
| --- | --- | --- |
| **Public API and contract** | Connection factory, public session model, typed results, capability declarations, errors and cancellation semantics | Vendor-specific socket packets, UI workflows, SQL query-builder semantics |
| **Shared core** | Session lifecycle rules, cancellation/deadlines, bounded resource controls, credential policy, common diagnostics, connection pool orchestration and testable contracts | A fictional universal SQL wire protocol or lossy vendor type coercion |
| **Model interfaces** | Relational query/transaction interfaces and separately document, graph, key-value or other appropriate operation families | Forced SQL support on non-SQL products |
| **Vendor adapter** | Vendor handshakes, network protocol, authentication exchanges, native command sequencing, packet/result parsing, native types, errors, metadata and capability discovery | Shell, Workbench, ORM business logic or other vendors' behaviour |
| **Transport and identity** | TCP, Unix-domain sockets where supported, TLS with peer verification, deadlines, cleanup and transport telemetry | Assuming TLS presence proves database identity without hostname/CA validation |
| **Conformance suite** | Shared behavioural contracts, native engine fixtures, error/security scenarios, capability matrix and reproducible benchmark conditions | Mock-based claims of released vendor support |

Dependency direction: applications and developer libraries → published Driver API → shared core/model contracts → vendor adapters → underlying runtimes. **Never in reverse.**

The Driver should provide *both* a clearly bounded portable interface and an explicit way to access **native vendor capabilities**.

## 4. Proposed internal layout

This is a **logical ownership map**, not permission to create placeholder folders. Create files only when delivering a tested workflow.

~~~text
packages/
  driver/
    src/
      index.ts                       # documented public exports only
      core/
        contracts.ts                 # versioned identifiers and session contracts
        connection.ts                # open, use, close, cancellation lifecycle
        capabilities.ts              # declared and discovered features
        errors.ts                    # typed and redacted failures
        resources.ts                 # limits, deadlines, cleanup rules
        pooling.ts                   # cross-vendor pool orchestration
      models/
        relational.ts                # relational sessions, transactions, results
        document.ts                  # only once a real document adapter exists
        graph.ts                     # only once a real graph adapter exists
      vendors/
        mysql/
          index.ts                   # registration and public native extension
          configuration.ts           # validated MySQL target/options
          adapter.ts                 # connect + command/session boundary
          protocol/
            framing.ts               # incremental packet framing/sequence checks
            handshake.ts             # client/server capability negotiation
            commands.ts              # command state machine + prepared statements
            results.ts               # OK/ERR/metadata/rows, result boundaries
          auth/
            plugins.ts               # explicitly supported auth exchanges
          types.ts                   # native MySQL types and codecs
          metadata.ts                # native discovery/catalog operations
          capabilities.ts            # tested feature/version negotiation
          errors.ts                  # MySQL error mapping with native detail
    tests/                            # API, protocol fuzz, live vendor fixtures
~~~

The layout above is **illustrative**. In particular, not every vendor needs the same subdirectories or the same abstraction model. Shared transport, pooling, contracts and conformance harnesses must not be copy-pasted into every vendor. A vendor may require additional modules for protocol variants or native operations; conversely, a simpler embedded provider may need far fewer.

### Vendor adapter responsibility checklist

Every supported vendor adapter shall ultimately account for:

1. **Identity and configuration:** vendor/version, validated endpoint, client options, authentication mode, credential protection, explicit defaults.
2. **Transport:** connect/reconnect conditions, secure transport and peer identity, timeouts, protocol negotiation, flow control, cleanup.
3. **Protocol:** frames/messages, state machine, boundaries, server capabilities, fragmented packets and malformed input.
4. **Authentication:** required method(s), challenge/response handling, secure credential exchange and error redaction.
5. **Execution:** model-native operations; SQL text execution *where supported*; genuine server-side binding/preparation where promised; result-set framing and multiple-results rules.
6. **Type fidelity:** NULL, text/charset/collation, numbers/precision, dates/times/timezones, JSON, binary and vendor-specific values without silent loss.
7. **Transactions and session state:** begin/commit/rollback and isolation/savepoints where the engine supports them; explicit handling of session-scoped settings and errors.
8. **Metadata and capabilities:** server identity, schemas/catalogues and discoverable supported features, including native extensions.
9. **Pool/lifecycle hooks:** healthy checkout/reset/return, leak prevention, cancellation, reconnect safety and shutdown.
10. **Operational errors:** native error codes and context, stable library error class, safe diagnostics, retryability hints where justified.
11. **Qualification:** version-pinned real engine tests, security tests, limits/fuzzing, contract compliance, release support declaration.

The public Driver owns the *contracts*; the vendor implementation owns the *truth* about whether it can satisfy them.

## 5. API principles

The final names and programming language are **not** approved by this blueprint, but the semantics are required.

- **Explicit target:** specify engine ID, endpoint/deployment profile, authentication and security policy; no silent acceptance of unsupported engines.
- **Typed session:** after connection, surface actual server identity, supported models and negotiated capabilities. Different model sessions offer different operations.
- **Safe parameters:** values are bound via a real native mechanism; the library must never interpolate arbitrary parameter values into raw SQL. Where no safe parameter mechanism exists, do not promise parameter binding.
- **Precise native values:** return exact values and native type metadata, not just a universal string representation; lossy conversion requires explicit opt-in.
- **Transaction ownership:** transaction scope and connection pinning must be explicit; never retry an ambiguous transaction automatically.
- **Cancellable and bounded:** operations honour deadlines, cancellation/abort, maximum bytes/rows/resources and cleanup even after protocol failures.
- **Stable errors:** support native error details and a cross-vendor error taxonomy, without exposing secrets.
- **Resource ownership:** clear close/dispose, statement/cursor and result lifecycle; no phantom success after partial failures.
- **Capability-gated features:** both portable and vendor-native operations are discoverable. Unsupported functionality fails clearly, not silently.
- **No false compatibility:** a future query builder or ORM is a separate library; SQL:2023 conformance and database vendor behaviour are independent claims.

## 6. First complete vertical slice — proposal

**First target (proposed): MySQL 8.4 LTS, local/isolated and verified-TLS TCP.** This choice follows the initial goal of developing a complete proprietary MySQL-capable driver module, not a commitment that other vendors or cloud products can already connect. Later target versions/deployments are separately qualified.

**First user journey:** An application developer installs the NuBloxSQL Driver from a clean package, connects securely to a **real MySQL instance**, proves server identity, discovers server/schema information, runs parameterised reads and writes using **server-prepared statements**, controls a transaction, receives precise results/errors and closes every resource.

### End-to-end acceptance gates (all required)

| Gate | Pass condition |
| --- | --- |
| **A. Install/API** | Clean supported-runtime install; documented public entrypoint and an independent runnable example with zero private-package imports |
| **B. Connect/identity** | Genuine MySQL 8.4 connection and supported auth handshake; correctly verified TLS target identity in secure profile; failed CA/hostname/auth rejected |
| **C. Protocol robustness** | Incremental framed messages, sequence/length checks, fragmented/coalesced response handling and malformed-input failure without stream corruption |
| **D. Prepared execution** | Real server prepare/execute/close; string, numeric, NULL and binary parameters; no unsafe SQL substitution; injection test |
| **E. Results/types** | Multirow SELECT, field metadata, correct signed/unsigned numerical handling, decimal precision, binary, text charset and nullable values; explicit date/time handling |
| **F. Writes/transactions** | INSERT/UPDATE with affected rows, commit and rollback verified on the real database; no hidden automatic retry |
| **G. Errors/limits** | Authentication/privilege/query/protocol/timeout failures are structured and redacted; bounded results, cancellation or safe termination and cleanup |
| **H. Session/pool** | Repeated operation and close cycles; no dangling sockets/statements; if pooling is advertised, safe reuse/reset with isolation tests |
| **I. Metadata/features** | Server/vendor/version identity, basic schema/table discovery and an accurate first support/capability matrix |
| **J. Release evidence** | Reproducible CI against a pinned live server, security negative tests, API documentation and clean consumer-package test all pass |

*No portion is called a completed connector merely because framing, authentication tokens or a test mock has been written.* A complete initial Driver release can explicitly exclude Workbench, Shell, cloud IAM, replication, distributed transactions and full SQL:2023 feature coverage. These exclusions must be transparent; they must not be presented as completed end-to-end **platform** functionality.

### Version and feature matrix

For each advertised combination record: `vendor / serverVersion / dataModel / endpointType / transportSecurity / authentication / feature / status / evidence`. Use explicit `supported`, `experimental`, `unsupported` and `not-tested` statuses. Do not use `supported` without live evidence.

## 7. Follow-on order (not parallel speculative development)

1. **Prove one complete native adapter** against its first real engine. Use lessons learned to stabilise the public contracts.
2. **Prove a second genuinely distinct relational vendor** through the same public API, without suppressing vendor-native behaviour. This is the earliest meaningful cross-vendor claim.
3. **Deliver Shell's first complete journey** using only published Driver interfaces, with no shadow implementation.
4. **Deliver Workbench's same journey**, measuring task parity, errors and usability rather than counting screens.
5. **Qualify the first non-SQL model** using a distinct native contract, which tests whether universality is real rather than relational-specific.
6. **Add optional developer technologies and lifecycle workflows** after their contracts and professional outcomes justify them.

This ordering does not prevent security or correctness fixes. It prevents spreading engineering effort across unfinished vendors and products.

## 8. Decision controls

- Product scope and identity: **[PRODUCT.md](PRODUCT.md)** is authoritative.
- This document: Driver architecture **proposal**, not a mandate to implement all files.
- First vendor and technology choices: provisional until approved and verified.
- Historic source: available in [ARCHIVES.md](ARCHIVES.md), but never automatically reintroduced.
- External examples may inform engineering judgement **privately**; repo code, comments, commits and documentation must be original NuBloxSQL work.
- Any architecture change must preserve public contract correctness, Native fidelity, testability and honest capability evidence.

**Next actionable engineering decision:** approve or adjust the first complete Driver user journey and its exact supported MySQL target matrix; only then create the first runtime module and implement Gates A–J end to end.
