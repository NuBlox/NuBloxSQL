# Native Adapter and Shared Connection Routing Boundary

**Status:** Driver-internal router and native adapter contract implemented for the
four pre-existing SQL engines. No new DBMS, non-SQL engine or cloud provider is
qualified by this increment.

## Why this exists

NuBloxSQL is intended to be a universal **database driver** with honest native
interfaces, not a SQL syntax translator for document, graph and key-value
stores. Its current implementation and public `createClient`, `createPool`,
`createConnection` and `adapter` methods still operate on the qualified SQL
runtime families: MySQL, PostgreSQL, SQLite and SQL Server.

The public `index.js` remains the stable package façade. Internal
`lib/runtime/SqlAdapterRouter.js` owns SQL alias normalisation, resolution of
connection URLs and options, lazy adapter loading/caching and fail-closed
routing. `lib/runtime/NativeAdapterContract.js` owns the first model-neutral
runtime descriptor requirement. Neither module depends on Shell or Workbench.

## Model-neutral adapter contract

The **internal** `NativeAdapterContract` currently supports:

- `define({id, models, nativeInterface, operations})` — immutable declaration
  of adapter identity, one or more data models, one native interface and
  intended operation identifiers, all validated for shape and uniqueness.
- `assertRuntime(declaration, implementation)` — requires the native module
  to expose `createConnection(config)` and a matching
  `descriptor.identity.family`. SQL modules additionally require dialect
  services `quoteIdentifier` and `placeholder`.

These checks assert **module shape**, not that the adapter has connected,
authenticated, negotiated a protocol or passed live vendor tests. A declaration
does not register a runtime. Future non-SQL adapters require model-specific
operations and their own implementation/qualification gates.

## Routing guarantees

- The four existing SQL adapter factories remain **lazy**. Importing
  `nubloxsql` must not load engine protocols or network drivers.
- Canonical IDs are `mysql`, `postgresql`, `sqlite`, `sqlserver`.
  Existing aliases `pg`, `postgres`, `mssql`, `sql-server` remain valid.
- Explicit dialect/config and supported SQL URL routing retain their existing
  merge precedence, validation and public errors.
- A successful module load is cached; an invalid/failed load is not.
- Catalogue records, cloud service profiles and generic declarations never
  bypass runtime availability checks. Unsupported `mongodb`, `redis`,
  `oracle` etc. are **not** silently mapped onto an SQL driver.
- The router is private to the driver package; the public exported API and
  TypeScript client semantics do not change.

## Next adapter architecture increments

1. Separate common connection lifecycle (target identity, operation control,
   diagnostics, error envelopes, secret redaction) from SQL query interfaces.
2. Define native operation families per data model with explicit
   support/unsupported outcomes; do not invent universal SQL/transaction
   semantics for incompatible products.
3. Implement an internal extensible adapter registry with safe lifecycle
   registration, version/capability negotiation, audited provenance and
   compatibility policies **before** enabling third-party plugins.
4. Add a real non-SQL adapter only with its native transport, authentication,
   core operations, TypeScript API and live integration evidence.
5. Independently qualify SQL coverage across Oracle, Db2, MariaDB and
   cloud services. Common wire-protocol ancestry is not proof of cloud IAM,
   TLS, credential refresh or version compatibility.

## Security and release qualification

Adapter boundaries must not make credentials or connection URLs containing
secrets visible in errors or logging. Credential storage, token refresh,
TLS policy, private network access, cloud proxy management and engine-specific
authorization remain explicit future requirements. No permissive TLS fallback
is introduced.

Changes affecting SQL routing require the existing engine/dialect CI workflows,
Node 22/24/26 package tests, TypeScript packed consumers, public API contract
checks and `test/native-adapter-contract.js` and `test/sql-adapter-router.js`.

The long-term identity **universal database driver** is architectural intent,
not a claim that all vendors currently have executable NuBloxSQL adapters.
