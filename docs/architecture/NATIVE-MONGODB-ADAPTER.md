# MongoDB Native Document Adapter

**Status:** Initial MongoDB document adapter with standalone, replica-set
seed-list and DNS SRV target configuration. Replica-set discovery and SCRAM
authentication have dedicated ephemeral integration checks; real external SRV
deployments remain unqualified. This is a model-native `document-api` client,
**not** a MongoDB SQL dialect, a new wire protocol implementation, or a
cloud-provider certification.

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

Use `ping`, `findOne`, bounded `find`, bounded async `iterate`,
`insertOne`, `updateOne`, `deleteOne` and `countDocuments`. The API returns native document objects, including
MongoDB BSON values such as ObjectId. Query filters and updates are passed to
the official MongoDB driver; no SQL compilation or query translation occurs.
The client factory `createClient({dialect:'mongodb'})` remains unsupported.

If `mongodb` is missing, connection attempts reject with
`NUBLOX_MONGODB_DRIVER_NOT_INSTALLED`. Install the optional dependency in
the application. Unit/release checks work without the optional package.

## Replica sets, DNS SRV and bounded streaming

```js
// A replica set: the vendor driver discovers members and verifies 'mainRs'.
const replica = createNativeConnection('mongodb', {
  database:'project', replicaSet:'mainRs',
  seeds:[{host:'db1.example.test',port:27017},
         {host:'db2.example.test',port:27017}],
  tls:true,
  username:process.env.MONGO_USER,
  password:process.env.MONGO_PASSWORD,
  authSource:'admin'
});

// DNS SRV: TLS is enforced; no raw MongoDB URL or credentials in the URL.
const srv = createNativeConnection('mongodb', {
  database:'project',srvHost:'cluster.example.test',
  username:process.env.MONGO_USER,
  password:process.env.MONGO_PASSWORD
});

await replica.connect();
try {
  for await (const doc of replica.iterate('components', {status:'active'},
                                       {limit:250,batchSize:25})) {
    // Stop early when useful; this releases the server cursor.
    if (doc.code === 'A-001') break;
  }
} finally {
  await replica.close();
}
```

## Supported security and operational controls

- **Topology modes:** direct `host` and `port` (default `127.0.0.1:27017`);
  `seeds:[{host,port}, ...],replicaSet:'rsName'` for replica-set
  discovery (maximum 16 seeds); or `srvHost:'cluster.example.test'`
  for DNS SRV discovery. The modes are mutually exclusive and only vetted
  hostnames/ports are accepted; raw URIs, URI options, embedded credentials
  and provider proxy management are forbidden. The official driver performs
  server selection and topology monitoring. SRV is TLS-only, including when
  DNS records supply additional hosts.
- **Remote hosts (including *every* seed) require `tls:true`**. SRV mode
  automatically requires verified TLS; `tls:false` in SRV mode is rejected.
  TLS verification remains enabled using
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
- `find` and `iterate` are bounded to 100 documents by default
  (configurable up to 1,000); callers cannot remove the limit with arbitrary
  options. Reads use `maxTimeMS` for server-side execution limits. Both
  APIs explicitly release MongoDB cursors on normal completion, operation
  failure and early iterator termination. `iterate` is an async iterable
  that fetches batches without forcing the entire result into memory.
- The official driver handles retryable **reads** and ongoing replica-set
  server selection. NuBloxSQL leaves automatic retryable **writes** disabled
  to avoid hidden write replay in the initial public API. Ephemeral
  three-member primary-loss CI verifies rediscovery and application-level
  read/write recovery after an election, but this does not certify recovery
  under arbitrary network partitions, multi-region conditions or Atlas.
- `ping()` makes a real read-only round trip to the server and returns
  `true` when the server responds successfully. It is not a cached
  `connected` flag. During elections it can return sanitized
  `NUBLOX_MONGODB_PING_FAILED` without closing the client. Applications
  should retry **safe reads and explicitly idempotent operations** after
  recovery; do not blindly replay writes whose completion is uncertain.
- Errors from the driver are presented as stable NuBloxSQL error codes rather
  than raw vendor exception messages, to avoid accidentally disclosing
  credential-bearing configuration.

Write operations are **not read-only**: the caller's database account and
application workflow are responsible for authorization, consent and audit.
This adapter does not yet implement a documented transaction/session API,
change streams, bulk operations, arbitrary URI options, custom retry policies,
managed cloud credentials or provider IAM/federated authentication. Authenticated
integration verifies SCRAM on an ephemeral standalone server; no provider IAM
claims are made.

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
MongoDB 7.0 and 8.0 containers, a separately authenticated MongoDB 8.0
server (successful SCRAM and rejected bad password), an initialized
single-member replica set (discovery + CRUD), **and three ephemeral replica-set
members**. The three-member CI scenario waits for a majority-committed
secondary read, stops the actual elected primary, and verifies that the
unchanged NuBloxSQL client recovers access after a secondary wins election.
It tests a new read, a safe application-level update, and delete after recovery,
and emits only sanitized fixed-format results. The test is explicitly gated to
disposable CI containers and cleans them up. SRV URI assembly and enforced TLS
are qualified offline using a fake MongoClient, **not by contacting a
real DNS SRV provider**. These tests do not certify MongoDB Atlas, cross-region
partitions, transparent in-flight write replay, sharded clusters or every
MongoDB-compatible product.

## Vendor references

- [MongoDB official Node.js driver](https://github.com/mongodb/node-mongodb-native)
- [Official MongoClient connection settings](https://www.mongodb.com/docs/drivers/node/current/connect/connection-options/)
- [MongoDB replica-set elections](https://www.mongodb.com/docs/manual/core/replica-set-elections/)
- [Connection troubleshooting and failover considerations](https://www.mongodb.com/docs/drivers/node/current/connect/connection-troubleshooting/)
- [TLS configuration](https://www.mongodb.com/docs/drivers/node/current/fundamentals/connection/tls/)
