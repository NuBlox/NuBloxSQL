# Support, qualification and release policy

**Current reboot support status: NO IMPLEMENTED DRIVERS, TOOLS OR CLOUD CONNECTORS ON MAIN.** All previously implemented functionality is on the [archive](ARCHIVE.md) and must be reintroduced only after the corresponding design and acceptance gates.

## Separate support declarations

A support claim must be recorded at the intersection of:

- Database product/vendor, version and edition.
- Native data/query model, protocol and supported capabilities.
- Node/runtime/platform version and deployment type.
- Auth method, TLS mode, secret lifecycle and network connectivity.
- Exact test evidence, CI environment, limitations and release version.

**A reference name is not an adapter.** A unit test with mocked sockets is not native wire-protocol evidence. A standard SQL endpoint is not proof of cloud IAM/Entra/private-network support.

## Planning matrix (not release support)

| Engine family | Target evaluation | Release status on new main | Special qualification |
| --- | --- | --- | --- |
| PostgreSQL | First SQL vertical slice | Not implemented | Protocol, version, auth/TLS, metadata and transaction behaviour |
| MySQL | Subsequent SQL adapter | Not implemented | MySQL native authentication/TLS and pooling |
| SQLite | Embedded SQL adapter | Not implemented | File modes, locks, changes, transaction and corruption behaviour |
| SQL Server | Native TDS adapter | Not implemented | TDS versions, login/TLS, metadata, type fidelity |
| MongoDB | First document candidate | Not implemented | Document operations, topology, credentials and bounded cursors |
| Redis | First key-value candidate | Not implemented | Native RESP, credentials/TLS, standalone vs cluster |
| Other SQL/non-SQL vendors | Research and prioritisation | Not implemented | Each requires own capability and real-engine evidence |
| Managed/cloud database variants | Explicit project goal | Not qualified | Correct protocol + credential issuance/refresh + TLS + private/public networking |

These rows represent priorities for evaluating archived assets, not a commitment to ship all listed products in an early release.

## Minimum acceptance for a supported adapter

1. Real instance/fixture version and edition documented; clean environment reproducible.
2. Connection, identity discovery, authentication errors, TLS identity and orderly teardown tested.
3. Native command/query semantics, typed data, parameterisation (where applicable), timeouts, cancellation and quotas tested.
4. Native transactions/consistency supported only when demonstrated, otherwise explicitly refused.
5. Error classification and leak-resistant logging/telemetry tested.
6. Dependency, licence and packaging review completed.
7. Public API consumer test demonstrates installation and selected professional task.
8. Explicit limitation list published alongside capability and release evidence.

## Release gates

- **G0 — specification:** product, tasks, acceptance, security boundaries and first adapter chosen.
- **G1 — reproducible build:** strict TypeScript and Node compilation, test/lint/typecheck, locked deps and package contents verified.
- **G2 — adapter qualified:** real-engine acceptance across declared platform/version matrix.
- **G3 — first task delivered:** Driver + independent Shell + Workbench complete TASK-001 with identical evidence semantics.
- **G4 — independent release candidates:** usability, security, packaging, docs, rollback and upgrade behaviour verified per product.
- **G5 — release:** signed/versioned distribution and post-release support plan; no accidental overwrite of legacy npm v1.

Until G1, this repository has only a documentation gate. Once G1 is reached, introduce the smallest build CI capable of verifying actual code. Prefer failing loudly to cosmetic green checkmarks.
