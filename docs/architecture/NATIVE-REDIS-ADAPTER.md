# Redis Native Driver — Initial RESP2 Adapter

**Status:** Initial native key-value adapter. This is a **separate non-SQL runtime**;
Redis commands are never routed through `createClient`, SQL dialects or the SQL
compiler. Redis Cluster, Sentinel, RESP3 push messages, Pub/Sub, pipelines,
automatic reconnection and Redis Cloud credentials are **not implemented**.

## Use

```js
const {createNativeConnection} = require('nubloxsql');

const db = createNativeConnection('redis', {
  host:'127.0.0.1',
  port:6379,
  commandTimeout:10000
});
await db.connect();
try {
  console.log(await db.ping());           // PONG
  await db.set('example:key','hello');    // OK
  console.log((await db.get('example:key')).toString('utf8'));
  console.log(await db.del('example:key')); // 1
} finally {
  await db.close();
}
```

Use `db.command('COMMAND', ...args)` for a native Redis command with RESP2
request/reply semantics. Arguments accept strings, finite numbers, bigint
values and Buffers. A bulk-string reply is a **Buffer**, not a string, to
preserve binary values; null replies stay null, integer replies are numbers
when safe and bigint otherwise. Simple strings are decoded to UTF-8 strings.
This is not a general-purpose object mapping or SQL abstraction.

A configured Redis ACL account may authenticate with `username` and
`password`. A password alone uses the default account. `database` selects
a logical database when the server supports SELECT. Pass credentials only
through trusted configuration management, never logs or connection URLs.

## Transport and resource limits

The driver is built with Node.js `net`/`tls` and has **no external npm
dependencies**. Plain TCP is permitted **only to loopback endpoints**.
Non-loopback Redis endpoints require TLS, and `rejectUnauthorized:false` is
not allowed. Use `tls:true` for the system trust store, or set
`tls:{ca: trustedCa,servername:'redis.example.com'}` when connecting
through a private endpoint or IP route. Explicit `servername` must be a DNS
name and is mandatory for IP endpoints when TLS is used.

The initial driver serializes commands and limits:
- `connectTimeout` and `commandTimeout`: 10 seconds by default; max 60 seconds
- `maxCommandBytes`: 1 MiB by default; max 16 MiB
- `maxResponseBytes`: 8 MiB by default; max 16 MiB
- RESP2 array elements: max 4,096; depth: max 16

A timed-out or malformed response destroys the connection, rather than
accidentally delivering a late response to another command. Server-side
RESP2 `-ERR` replies reject the command but do not break the connection.
The response parser forbids unsolicited/push traffic because the first
runtime does not implement a subscription dispatcher.

The generic `command()` method exposes native Redis commands. **It is
not a read-only operation**: apply the Redis ACL principle of least privilege
and use separate credentials for management versus application traffic.
This runtime does not interpret ACLs, manage replication, rotate passwords,
or implement Redis Cluster MOVED/ASK redirects.

## Testing and qualification

```bash
npm run test:redis
npm run verify:release
npm run release:qualify
npm pack --dry-run
```

`npm run test:redis` executes bounded RESP2 parser, in-process local TCP,
authentication, binary preservation and timeout/security regression tests.
The `NuBloxSQL Redis Native` GitHub Action also runs the native smoke test
against ephemeral Redis 7.4 and 8.2 containers. These tests qualify only the
covered protocol and deployment combinations; they do not certify every
Redis edition, Redis Cloud offering, Redis-compatible vendor or deployment.

The SQL-client factory intentionally still rejects
`createClient({dialect:'redis'})`. Use `createNativeConnection` and keep SQL
capability claims restricted to the four implemented SQL engines.

Protocol reference: [Official Redis RESP specification](https://redis.io/docs/latest/develop/reference/protocol-spec/)
and [Redis AUTH](https://redis.io/docs/latest/commands/auth/).
