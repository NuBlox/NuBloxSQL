# MongoDB Native Document Adapter

**Status:** Initial direct-host MongoDB document adapter. This is a
model-native `document-api` client, **not** a MongoDB SQL dialect, a new wire
protocol implementation, or a cloud-provider certification.

NuBloxSQL uses the **official Apache-2.0 MongoDB Node.js driver** for BSON,
SCRAM authentication, MongoDB transport, server selection and TLS. That driver
is optional and installed by applications separately. The `nubloxsql` npm
package itself retains **zero declared runtime npm dependencies**.

## Installation and usage

```bash
npm install nubloxsql mongodb@7
```

```javascript
const {createNativeConnection} = require('nubloxsql');

const db = createNativeConnection('mongodb', {
  host: '127.0.0.1',
  port: 27017,
  database: 'project'
});
await db.connect();
try {
  await db.insertOne('components', {code:'A-001',status:'active'});
  const active = await db.find('components', {status:'active'}, {limit:50});
  console.log(active);
  const count = await db.countDocuments('components', {status:'active'});
  console.log(count);
} finally {
  await db.close();
}
```

Use `findOne`, bounded `find`, `insertOne`, `updateOne`, `deleteOne`
and `countDocuments`. The API returns native document objects, including
MongoDB BSON values such as ObjectId. Query filters and updates are passed to
the official MongoDB driver; no SQL compilation or query translation occurs.
The client factory `createClient({dialect:'mongodb'})` remains unsupported.

If `mongodb` is missing, connection attempts reject with
`NUBLOX_MONGODB_DRIVER_NOT_INSTALLED`. Install the optional dependency in
the application. Unit/release checks work without the optional package.

## Supported security and operational controls

- **Direct host and port**, default `127.0.0.1:27017`; no connection URLs,
  embedded credentials, SRV records or provider proxy management.
- **Remote hosts require `tls:true`**. TLS verification remains enabled using
  the official driver's normal certificate validation. `tlsCAFile` can name
  a trusted CA file. Unsafe `tlsInsecure`,
  `tlsAllowInvalidCertificates`, and `tlsAllowInvalidHostnames`
  configuration keys are explicitly rejected.
- Username/password are supplied as driver authentication options, **never
  placed into connection URLs**; `authSource` defaults to `admin`.
  For role-limited accounts, configure the correct auth database and grant
  only the required MongoDB roles.
- Connection and command timeouts are bounded (default 10,000 ms, maximum
  60,000 ms); connection pool size defaults to five and is capped at 20.
- `find` is bounded to 100 documents by default (configurable up to 1,000);
  callers cannot remove the limit by passing arbitrary options. Reads use
  `maxTimeMS` for server-side execution time controls.
- Errors from the driver are presented as stable NuBloxSQL error codes rather
  than raw vendor exception messages, to avoid accidentally disclosing
  credential-bearing configuration.

Write operations are **not read-only**: the caller's database account and
application workflow are responsible for authorization, consent and audit.
This adapter does not yet implement a documented transaction/session API,
change streams, bulk operations, topology discovery, URI/SRV endpoints,
automatic retry policy or provider IAM/federated authentication.

## Verification

```bash
npm run test:mongodb
npm run verify:release
npm run release:qualify
npm pack --dry-run
```

The offline tests inject a fake official-driver interface and run without
network access or the `mongodb` package. A dedicated
`.github/workflows/mongodb-native.yml` workflow installs official
`mongodb@7` in the CI runner and verifies CRUD through live ephemeral
MongoDB 7.0 and 8.0 containers. This is compatibility evidence for those
bounded operations and versions, **not** certification of MongoDB Atlas,
Replica Sets, Sharded Clusters or all MongoDB-compatible products.

## Vendor references

- [MongoDB official Node.js driver](https://github.com/mongodb/node-mongodb-native)
- [Official MongoClient connection settings](https://www.mongodb.com/docs/drivers/node/current/connect/connection-options/)
- [TLS configuration](https://www.mongodb.com/docs/drivers/node/current/fundamentals/connection/tls/)
