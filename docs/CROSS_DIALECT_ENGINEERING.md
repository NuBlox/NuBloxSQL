# NuBloxSQL Cross-Dialect Engineering Standard

NuBloxSQL is a multi-dialect database-driver platform. A dialect is not considered production-ready because it can connect and execute SQL; it must satisfy a common engineering standard while preserving database-native behaviour.

## Design principles

1. **Native-first, portable where honest.** Expose common contracts through `@nublox/sql-core`, but never hide meaningful database semantics behind a lowest-common-denominator API.
2. **Capability discovery, not assumptions.** Features are classified as `native`, `emulated`, `conditional`, `unsupported`, or `unknown`, with version and prerequisite metadata.
3. **Protocol correctness before convenience.** Framing, authentication, state machines, cancellation, error propagation and resource limits are release gates.
4. **Zero silent semantic drift.** Transaction isolation, autocommit, identifiers, nulls, numerics, timestamps, time zones, encodings and generated values must retain dialect semantics.
5. **Secure by default.** TLS verification, credential handling, authentication negotiation, secret redaction, bounded resources and safe defaults are mandatory.
6. **Backpressure everywhere.** Large result sets, bulk transfer and replication/change streams must support bounded-memory consumption.
7. **Observable without leaking data.** Timings, retries, pool state, protocol state and trace correlation are supported; SQL text and bind values require explicit opt-in/redaction policy.
8. **Version-aware behaviour.** Server version, edition, distribution and extensions may change capabilities; drivers must detect and expose these differences.
9. **Adversarially tested.** Truncated frames, malformed lengths, invalid encodings, protocol desynchronisation, network faults, server restarts and cancellation races are first-class tests.
10. **Compatibility is measured.** Every released dialect has unit, protocol-vector, live-server, version-matrix, type, fuzz/property, soak and benchmark gates appropriate to that engine.

## Capability domains

### Connectivity and security
- TCP, Unix/domain sockets and platform-specific local transports where applicable
- TLS modes, certificate verification, SNI, custom CAs and mutual TLS
- authentication mechanisms and re-authentication
- proxies, gateways, cloud endpoints and failover/multi-host discovery
- connect timeout, DNS behaviour, keepalive and network-family selection
- credential rotation and token-based/cloud authentication where supported

### Protocol and execution
- text/simple query path
- prepared/extended/binary execution
- named and positional binding
- multi-statement and multi-result processing
- server-side cursors/portals
- streaming and backpressure
- cancellation, timeout and deadlines
- server notices, warnings, diagnostics and informational messages
- session-state changes and protocol resynchronisation after errors

### Transactions
- autocommit semantics
- isolation levels and dialect-specific variants
- read-only/read-write transaction modes
- savepoints
- transaction-aborted states
- deadlock/serialization classification
- two-phase/distributed transaction support where native
- transactional versus implicit-commit DDL

### Type system
- signed/unsigned integer ranges and arbitrary precision
- decimal/numeric precision and scale
- floating-point special values
- text, national character sets, collations and binary strings
- booleans and bit strings
- dates, times, timestamps, intervals and time zones
- UUID/GUID types
- JSON/document types
- arrays, ranges, composites, enums, domains and user-defined types
- spatial/geometric types
- XML
- LOB streaming
- row identity/generated values
- driver-defined codecs and safe fallback for unknown extension types

### Metadata and schema
- catalogs, schemas, databases and namespaces
- tables, views and materialized views
- columns, defaults, generated/computed columns
- primary, unique, foreign and check constraints
- indexes including expression, partial/filtered and specialised indexes
- sequences, identities and auto-increment objects
- routines, packages, triggers and events
- partitions/shards/distribution keys
- roles, grants and ownership
- extensions/modules and engine-specific objects

### Advanced database facilities
- COPY/bulk loaders and bulk DML
- native upsert/merge/returning semantics
- full-text search
- spatial/GIS
- change data capture and replication streams
- notifications/pub-sub
- advisory/application locks
- query plans and `EXPLAIN`/runtime analysis
- session variables and role switching
- server-side procedures/functions
- cloud warehouse asynchronous jobs and result pagination

### Pooling and resilience
- bounded pools and acquisition queues
- idle/lifetime eviction
- validation and broken-connection detection
- transaction-safe release
- prepared statement cleanup/cache invalidation
- session reset
- server restart/failover recovery
- retry classification separated from retry policy
- graceful drain and deterministic shutdown
- leak detection and pool telemetry

### Performance
- allocation-sensitive packet parsing
- buffer reuse without data corruption
- batched writes and Nagle/flush considerations
- prepared statement caching
- high-throughput bulk paths
- result decoding strategies
- configurable row representation
- low-overhead metrics hooks
- memory soak testing and long-running connection tests

## Dialect families

The SQL Core family registry intentionally covers both transactional databases and analytical engines. Support is delivered incrementally and must not imply identical semantics.

| Family | Primary engineering concerns |
| --- | --- |
| MySQL | capability flags, auth plugins, binary protocol, multi-results, session tracking, binlog/CDC, unsigned numerics |
| MariaDB | MySQL protocol compatibility plus MariaDB-specific auth, metadata, RETURNING/features and divergence by version |
| PostgreSQL | extended query protocol, portals, COPY, notifications, arrays/composites/ranges, SCRAM, cancel requests |
| CockroachDB | PostgreSQL wire compatibility plus serializable transaction retries and distributed SQL semantics |
| SQLite | embedded lifecycle, locking/busy handling, WAL, dynamic typing, extensions, no network protocol |
| DuckDB | embedded analytical execution, vectorised results, nested types, extensions and large-result transport |
| SQL Server | TDS, MARS, integrated/Azure authentication, table-valued parameters, bulk copy, attention cancellation |
| Oracle | Oracle Net/TNS, service/SID semantics, NUMBER/date types, LOBs, REF CURSORs, PL/SQL, FAN/HA considerations |
| Db2 | DRDA, packages, schemas, DECFLOAT, LOBs, z/OS versus LUW differences |
| Snowflake | cloud auth, async queries, Arrow/result chunking, warehouse/session semantics |
| Redshift | PostgreSQL-derived protocol with warehouse-specific COPY, distribution/sort keys and feature divergence |
| BigQuery | HTTP/gRPC job model rather than traditional sessions, pagination, Storage API, nested/repeated types |
| ClickHouse | native/HTTP protocols, columnar blocks, compression, distributed execution and streaming inserts |

Additional dialect families remain valid through SQL Core's open string family type; the registry is not a closed universe.

## Release gates for a production dialect

A production designation requires, at minimum:

- contract conformance with SQL Core
- documented capability profile with conditional prerequisites
- strict protocol/resource limits
- secure transport/authentication coverage
- deterministic cancellation and timeout cleanup
- transaction and pool lifecycle tests
- data-type boundary vectors
- malformed/adversarial input tests
- live CI against every actively supported server major version where practical
- compatibility tests for claimed wire/API compatibility
- memory soak and leak checks
- benchmark baselines with regression thresholds
- observability/redaction tests
- upgrade/migration notes for behavioural changes

## Implementation order

1. Harden SQL Core capability/semantic contracts.
2. Bring native MySQL and PostgreSQL to the complete release gate and use them to pressure-test the abstractions.
3. Add SQLite/DuckDB to prove embedded-engine semantics.
4. Add SQL Server and Oracle to prove substantially different enterprise wire protocols and type systems.
5. Add MariaDB/CockroachDB/Redshift as compatibility-but-divergent families.
6. Add cloud/analytical engines such as Snowflake, BigQuery and ClickHouse using the same capability model without pretending they are session-oriented OLTP databases.

Every new dialect must add capability metadata and conformance tests before higher-level applications depend on it.
