# Native Adapter and Shared Connection Routing Boundary

**Status:** The four SQL engines retain the internal SQL router; a separate closed
non-SQL router loads initial Redis RESP2 standalone and MongoDB document runtimes. Provider
cloud qualification remains independent.

## Why this exists

NuBloxSQL is intended to be a universal **database driver** with honest native
interfaces, not a SQL syntax translator for document, graph and key-value
stores. Its current implementation and public `createClient`, `createPool`,
`createConnection` and `adapter` methods still operate on the qualified SQL
runtime families: MySQL, PostgreSQL, SQLite and SQL Server.

The public `index.js` remains the stable package façade. Internal
`lib/runtime/SqlAdapterRouter.js` owns SQL alias normalisation and connection
URL/config precedence, delegating adapter registration/loading to
`lib/runtime/NativeAdapterRegistry.js`.
`lib/runtime/NativeAdapterContract.js` owns the first model-neutral runtime
descriptor requirement. None of these components depends on Shell or Workbench.

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

### Immutable native adapter registry (internal)

`NativeAdapterRegistry.create(registrations)` accepts a complete list of
`{ id, models, nativeInterface, operations, load }` records and returns a
**closed** registry. All declarations are validated before construction
completes; registrations are immutable and cannot be appended, replaced or
unregistered after creation.

- `get(id)` returns a frozen declaration, or `null` for unknown IDs.
- `list()` returns a frozen, declaration-only snapshot. Executable loader
  functions and credentials are never exposed.
- `load(id, operation?)` rejects unregistered IDs and undeclared operations
  **before** executing a loader; loaded modules must pass the runtime contract.
- Loaders remain lazy and successful implementations are cached once. Failed,
  incomplete or recursive loader attempts are never cached.
- SQL routing registers only the four built-in SQL engines, with declared
  `sql.query` and `relational` model; aliases are normalized before registry
  lookup.

**Declaration, loading and qualification are different states.** Operation
declarations only specify intended native interface coverage; they do not
prove any operation executes, that credentials are valid or that a vendor is
live-qualified. A mock document adapter in tests demonstrates the contract
without alone enabling any external product.

No public adapter registration, plugin loading, third-party entry points or
non-SQL SQL-client routing is exposed. The separate public `createNativeConnection`
factory currently routes Redis RESP2 `key-value.command` and MongoDB native
`document.read` / `document.write` rather than `sql.query`.
See [Redis native adapter](NATIVE-REDIS-ADAPTER.md) and
[MongoDB native adapter](NATIVE-MONGODB-ADAPTER.md). This is a closed internal foundation
until a separate security, version and authorization review approves broader
registration.

## Routing guarantees

- The four existing SQL adapter factories remain **lazy**. Importing
  `nubloxsql` must not load engine protocols or network drivers.
- Canonical IDs are `mysql`, `postgresql`, `sqlite`, `sqlserver`.
  Existing aliases `pg`, `postgres`, `mssql`, `sql-server` remain valid.
- Explicit dialect/config and supported SQL URL routing retain their existing
  merge precedence, validation and public errors.
- A successful module load is cached; an invalid/failed load is not.
- Catalogue records, cloud service profiles and generic declarations never
  bypass runtime availability checks. Unsupported `mongodb`, `oracle` etc.
  are **not** silently mapped onto an SQL driver. Redis is available only
  through its explicit non-SQL native factory.
- The router is private to the driver package; the public exported API and
  TypeScript client semantics do not change.

## Next adapter architecture increments

1. Separate common connection lifecycle (target identity, operation control,
   diagnostics, error envelopes, secret redaction) from SQL query interfaces.
2. Define native operation families per data model with explicit
   support/unsupported outcomes; do not invent universal SQL/transaction
   semantics for incompatible products.
3. Extend the now-implemented **closed native adapter registry** with actual
   version/capability negotiation, audited provenance and compatibility
   policies **before** considering third-party plugins. The registry currently
   validates only identity, declared operations and module shape.
4. Extend the initial Redis native adapter (RESP2 and ACL authentication with
   standalone live qualification) toward clustering, topology, RESP3 and failover
   only after dedicated compatibility/security evidence.
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
checks and `test/native-adapter-contract.js`, `test/native-adapter-registry.js`
and `test/sql-adapter-router.js`.

The long-term identity **universal database driver** is architectural intent,
not a claim that all vendors currently have executable NuBloxSQL adapters.
