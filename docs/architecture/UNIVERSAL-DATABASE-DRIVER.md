# Universal Database Driver — Vendor and Cloud Boundaries

**Status (13 October 2026): architecture and catalogue foundation implemented; non-SQL runtimes and cloud-native authentication are not yet implemented.**

The canonical [Product Blueprint](../product/BLUEPRINT.md) defines NuBloxSQL as a **universal database driver foundation**, with **NuBloxSQL Shell** and **NuBloxSQL Workbench** as separate tools for database professions.

## Product model

**Four independent dimensions must never be conflated:**

1. **Database model** — relational, document, key-value, graph, wide-column, search, time-series, vector, or a combination. Models overlap.
2. **Database product and vendor** — PostgreSQL, MongoDB, Oracle, Redis, Neo4j, IBM Db2, DynamoDB, and others. A name in the catalogue does not mean the client implements its wire protocol.
3. **Native interface and protocol** — SQL over MySQL/PostgreSQL/TDS, document APIs, key-value commands, Cypher, CQL, HTTP/REST or vendor-specific APIs. SQL capability semantics apply **only** where the native interface is SQL; non-SQL databases must not be forced into SQL.
4. **Deployment/hosting** — local, self-hosted, managed cloud or cloud-native API. Authentication, TLS, network routing, private links and token renewal belong to their correct adapter/provider layers and are not automatically inherited from a base DBMS.

The initial [native adapter contract](NATIVE-ADAPTER-BOUNDARY.md) separates module
identity and lazy SQL routing from the public `index.js` façade. It is internal
foundation infrastructure; it does not enable non-SQL connectivity or cloud
IAM/TLS flows by itself.

The shared driver kernel can eventually expose common **intent and metadata**, including connection lifecycle, authenticated target identity, capability negotiation, cancellation, streaming with backpressure, diagnostics, structured error evidence and authorization. It must not promise uniform SQL statements, transactions, keys, schemas or isolation across incompatible engines.

### Real current runtime support

- **Existing SQL runtimes:** PostgreSQL, MySQL, SQLite, SQL Server. Individual capability and version qualification remains separate; the SQL public API is unchanged.
- **Existing SQL reference catalogue:** **100 vendor SQL profiles** in `dialectRegistry`, independently preserved and exposed via `databaseTechnologyRegistry.relationalSqlProfiles`. Profile presence means **discovered/reference-only** unless `driver.routable` is true. Oracle, Db2, Snowflake, BigQuery, SAP HANA, Teradata, DuckDB and other vendors remain **unimplemented** as connection drivers.
- **Cross-model catalogue:** `databaseTechnologyRegistry` provides representative document, graph, key-value, wide-column, search, time-series, vector and multi-model families. Only the same four existing SQL runtimes are routable.
- **Cloud services:** `cloudDatabaseRegistry` describes managed SQL and non-SQL services separately from engines; **zero cloud-hosted services have vendor-specific live qualification** here.
- `cloudDatabaseRegistry.planConnection` and `planCloudDatabaseConnection` accept a service ID and **credential-free** endpoint/port. They provide a base SQL driver **hint** only where a compatible native SQL protocol may be used; unsupported interfaces have `driverHint:null` and `status:'not-implemented'`. They are **not connection methods**.

## Cloud connection requirements

For AWS RDS/Aurora, Azure SQL and managed PostgreSQL/MySQL, an existing SQL protocol driver **may** be reused with an explicitly reachable endpoint, supported authentication, verified TLS and native DBMS privilege controls. **No vendor-specific IAM, Microsoft Entra or certificate provisioning is implemented.** Likewise, a pre-existing external proxy may expose a localhost standard port.

Google Cloud SQL proxy-based profiles deliberately require an **already running, separately configured local proxy**: this package neither launches it nor authenticates it. A proxy does not guarantee all engine-specific TLS requirements are met. Do not turn the returned `driverHint` into a production connection by blindly adding credentials.

**Examples (metadata only):**

```js
const sql = require('nubloxsql');

// Existing SQL runtime candidate. NOT a complete, security-ready connection config.
const aws = sql.planCloudDatabaseConnection({
  serviceId: 'aws-rds-postgresql',
  endpoint: 'example.cluster-abcdefghijkl.eu-west-2.rds.amazonaws.com'
});
// aws.driverHint.dialect === 'postgresql'
// aws.requirements.transportSecurity === 'must-be-verified-by-caller'

// Cloud SQL Auth Proxy MUST already be running and configured on the same host.
const gcp = sql.planCloudDatabaseConnection({
  serviceId: 'gcp-cloudsql-postgresql',
  endpoint: '127.0.0.1',
  port: 5432
});

// Native Snowflake adapter is not shipped.
const snowflake = sql.planCloudDatabaseConnection({ serviceId: 'snowflake' });
// snowflake.status === 'not-implemented'; snowflake.driverHint === null
```

All cloud plans explicitly reject credential-bearing configuration keys (passwords, tokens, URLs), malformed endpoints or insecure remote proxy hints. Neither secret storage nor token refresh is introduced.

## Required architecture before implementing a non-SQL vendor

1. Specify a **vendor-independent adapter contract** separating identity, transport, authentication, connection pooling and capabilities from query-model extensions.
2. Define native operation namespaces: `sql.query`, `document.read`, `key-value.command`, `graph.query`, `search.query`, `vector.search`. A name in `candidateOperations` is **not** a working API.
3. Require trusted identity, no credential persistence, verified endpoint/TLS, capability-gated operations, bounded resources, cancellation semantics, native errors and explicit information-loss boundaries.
4. Implement adapters **one at a time**, with unit tests, integration tests against real compatible releases, adverse-auth/TLS cases, version matrices and release evidence. Do not route a non-SQL vendor into the SQL compiler.
5. Qualify cloud deployments **independently** of local wire-protocol qualification. Private-network reachability, IAM/Entra/token rotation, TLS verification, regional endpoints, failover and provider APIs are separate acceptance categories.
6. Expand Shell and Workbench using the same public vendor-neutral contract, selecting feature-specific UI/commands only when the adapter has genuinely qualified those operations.

**Relational vendor coverage goal:** catalogue all relevant vendors, prioritize certified first-party/direct protocols, document version/edition and cloud compatibility, and progressively qualify each. Do not claim that the current 100 SQL profiles are drivers or that every existing and future vendor is already supported.

## Vendor primary references

- [AWS RDS IAM database authentication](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/UsingWithRDS.IAMDBAuth.html)
- [Google Cloud SQL Auth Proxy overview](https://docs.cloud.google.com/sql/docs/postgres/sql-proxy)
- [Google Cloud SQL for SQL Server Auth Proxy](https://docs.cloud.google.com/sql/docs/sqlserver/sql-proxy)
- [Microsoft Azure SQL authentication](https://learn.microsoft.com/en-us/azure/azure-sql/database/authentication-aad-overview)
- [Snowflake Node.js driver](https://docs.snowflake.com/en/developer-guide/node-js/nodejs-driver)
