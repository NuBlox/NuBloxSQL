# Universal Database Driver — Vendor and Cloud Boundaries

**Status (14 October 2026): the four existing SQL drivers and initial native Redis RESP2 and MongoDB document adapters are implemented; most non-SQL vendors and cloud-native authentication remain unimplemented.**

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
- **Initial non-SQL runtime:** Redis RESP2 standalone key-value commands via `createNativeConnection('redis', config)`. It does **not** use the SQL client or SQL compiler. See [Redis native adapter](NATIVE-REDIS-ADAPTER.md); Cluster, Sentinel and Redis Cloud are not yet qualified.
- **Initial MongoDB document runtime:** native `createNativeConnection('mongodb', config)` wraps the separately installed, Apache-2.0 official MongoDB Node.js driver; bounded find, async cursor iteration and CRUD, TLS enforcement for remote connections, validated replica-set seed lists/SRV targets, no SQL translation. See [MongoDB native adapter](NATIVE-MONGODB-ADAPTER.md). Live CI now covers SCRAM authentication and single-member replica-set discovery. It does not qualify Atlas/cloud identities, transactions, change streams, real DNS SRV deployments or multi-node failover.
- **Cross-model catalogue:** `databaseTechnologyRegistry` provides representative document, graph, key-value, wide-column, search, time-series, vector and multi-model families. Only the four existing SQL runtimes and the initial standalone Redis RESP2 runtime are routable.
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

## Opt-in live managed-cloud qualification

A **manual, protected GitHub Actions workflow** now provides an executable
read-only smoke qualification harness for existing PostgreSQL, MySQL and
SQL Server protocols. This is evidence for **one configured endpoint**, not a claim that
NuBloxSQL is qualified for an entire cloud provider, region, edition or
authentication method. The `cloudDatabaseRegistry` qualification fields
deliberately remain `cloud-unqualified` until a separate reviewed provider
certification programme is completed.

The workflow is `.github/workflows/managed-cloud-qualification.yml`, triggered
only by **Actions → NuBloxSQL Managed Cloud Qualification → Run workflow**.
It accepts AWS RDS / Aurora and Azure managed PostgreSQL/MySQL profiles,
and the existing SQL Server protocol for AWS RDS for SQL Server, Azure SQL
Database and Azure SQL Managed Instance. SQL Server uses the driver's encrypted
TDS 7.4 path for this smoke test, with `hostnameInCertificate`,
`rejectUnauthorized: true`, a trusted CA if configured, and the
`readOnlyIntent` login hint. **Read-only intent is not an access-control
boundary**: the provisioned database principal must itself have read-only
permissions. This harness deliberately does not qualify Entra or IAM sign-in,
or TDS 8.0 cloud deployment compatibility. Google Cloud SQL proxy profiles
are excluded because separate proxy lifecycle, transport and authentication
qualification is still required.

**Before starting the manual workflow:**

1. Create a protected GitHub Actions **Environment** named
   `cloud-qualification`, restrict deployments to `main`, and configure
   required reviewers as appropriate. Never run unreviewed branch code with
   cloud qualification secrets.
2. Store `NUBLOX_CLOUD_HOST`, `NUBLOX_CLOUD_USER`,
   `NUBLOX_CLOUD_PASSWORD` and `NUBLOX_CLOUD_DATABASE` as **environment
   secrets**. Use a dedicated read-only DBMS principal. The target must
   already be network reachable from the runner (or run the same script on
   your preconfigured trusted host). Do not grant schema or data mutation
   rights for qualification.
3. Optionally add `NUBLOX_CLOUD_PORT` (otherwise uses the profile's default
   port), `NUBLOX_CLOUD_SERVERNAME` (the certificate's actual DNS hostname
   when the TCP endpoint is an IP or has a different name), and
   `NUBLOX_CLOUD_CA_PEM` (trusted PEM CA chain when system trust is
   insufficient). Never disable peer certificate validation.
4. Select the matching service profile. Only explicitly supported direct-TCP
   PostgreSQL, MySQL or SQL Server service IDs are eligible. Wrong profiles or
   incomplete configurations fail before a connection attempt.

For a trusted local/CI environment with the same **environment variables**
already injected by your secret manager:

```bash
node test/cloud-connection-qualification.js
node scripts/qualify-cloud-connection.js
```

The first command is an **offline test using fake connections**, safe without
cloud credentials; it is also part of the normal Node 22/24/26 platform suite.
The second connects to the real managed endpoint, requires verified TLS
(under the driver-specific SSL or SQL Server TLS settings), verifies that
`rejectUnauthorized` is enabled and the negotiated socket is encrypted and
its certificate authenticated, runs only
`SELECT 1 AS nublox_cloud_probe`, and closes the connection. The printed
evidence contains only the service ID, dialect, fixed check names/statuses
and `single-live-endpoint-smoke-not-provider-certification`. It never prints
connection settings, credentials, certificates, endpoints or raw vendor
exceptions. A failure prints only a sanitized failure code; inspect and fix
networking, CA trust and database permissions separately.

A successful endpoint smoke test does **not** verify provider IAM/Entra,
credential rotation, failover, DNS recovery, TLS trust renewal, regional
resilience, production pooling or lifecycle management. No hosted database
credentials are configured in this repository, and the ordinary pull-request
CI **never** makes a secret-bearing cloud connection.

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
