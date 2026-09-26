# NuBlox Mastered Package — MySQL

This repository is the NuBlox-owned evolution of the `mysqljs/mysql` Node.js MySQL driver and is the authoritative source for `@nublox/mysql`.

## Provenance

- NuBlox repository: `https://github.com/NuBlox/NuBloxSQL`
- Upstream repository: `https://github.com/mysqljs/mysql`
- Upstream version at initial mastering: `2.18.1`
- Initial upstream commit: `dc9c152a87ec51a1f647447268917243d2eab1fd`
- Initial mastering date: `2026-09-26`
- Upstream licence: MIT (retained as `License`)
- NuBlox package identity: `@nublox/mysql`

## Mastering model

`NuBlox/NuBloxSQL` is authoritative NuBlox source. It is not a mirror and it must never be automatically replaced from upstream.

NuBlox changes are normal first-class source changes reviewed and tested through NuBlox pull requests. The upstream licence and attribution remain intact.

Upstream changes must be reviewed as immutable candidate commits and applied selectively through normal NuBlox pull requests rather than replacing the mastered codebase wholesale.

## Modern NuBlox foundation

The first NuBlox evolution layer adds:

- Node.js 22+ runtime baseline;
- CommonJS callback compatibility plus a first-class Promise entry point;
- `connection.promise()` and `pool.promise()` wrappers;
- abort-aware Promise queries using `AbortSignal` semantics;
- async-iterable row streaming via `iterate()`;
- transaction orchestration through `withTransaction()`;
- opt-in retry for MySQL deadlocks and lock-wait timeouts with bounded exponential backoff and jitter;
- pool saturation and utilisation statistics;
- pool health checks;
- `diagnostics_channel` events for query timing, query failure, pool acquisition and transaction retry without publishing parameter values;
- built-in TypeScript declarations;
- modern MySQL authentication including `caching_sha2_password`;
- standalone CI across supported Node.js versions and live modern MySQL versions.

See `NUBLOX-MYSQL-ROADMAP.md` for the competitive capability programme.
