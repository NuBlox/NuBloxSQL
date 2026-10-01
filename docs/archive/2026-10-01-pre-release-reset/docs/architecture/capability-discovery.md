# NuBloxSQL capability discovery

NuBloxSQL separates **declared dialect support** from **runtime/server evidence**.

The distinction is deliberate: observing a server version or protocol flag does not automatically promote a feature into the portable NuBloxSQL contract.

## Static report

Use `capabilityReport(dialect)` when no connection is available:

```js
const sql = require('nubloxsql');
const report = sql.capabilityReport('postgresql');

console.log(report.capabilities.preparedStatements);
console.log(report.support.preparedStatements);
console.log(report.runtime.nodeVersion);
```

The static report includes:

- dialect identity;
- the authoritative portable capability map;
- per-capability support evidence with source `dialect`;
- planned capabilities where a dialect publishes them;
- Node/runtime information;
- no server information because no server has been observed.

## Client reports

`client.capabilityReport()` is synchronous and never creates network traffic. It returns any server evidence already available on the client's current native connection.

`await client.discoverCapabilities()` may open/acquire a connection so that server-specific evidence is available. For pooled clients, NuBloxSQL borrows one connection and returns it to the pool after discovery.

```js
const db = sql.createClient(process.env.DATABASE_URL);
const report = await db.discoverCapabilities();

console.log(report.server?.version);
console.log(report.server?.protocolVersion);
```

## Dialect evidence

Current discovery exposes evidence already retained by the native runtimes:

- **MySQL** — server version, protocol version, handshake capability flags, authentication plugin and TLS state;
- **PostgreSQL** — server version and selected server parameters such as encodings and integer-datetime mode;
- **SQL Server** — LOGINACK product/version, TDS version, PRELOGIN information and negotiated ALPN;
- **SQLite** — embedded SQLite version from the active Node.js runtime and the database filename.

## Capability honesty

`report.capabilities` remains the authoritative portable contract. `report.server` is evidence, not an implicit promise that every server-advertised native feature is implemented by NuBloxSQL.

This prevents a common driver error: conflating what the database server could theoretically do with what the current client library safely implements and qualifies.
