# NuBlox Mastered Package — MySQL

This repository is the NuBlox-owned evolution of the `mysqljs/mysql` Node.js MySQL driver and is the authoritative source for `@nublox/mysql`.

## Ownership and copyright

- Copyright owner of all original NuBlox modifications, enhancements, documentation, tests, benchmarks and other original contributions: **Stephen Spittal**.
- Package author: **Stephen Spittal**.
- Upstream `mysqljs/mysql` portions retain their original copyright notice and MIT licence attribution as required by the inherited licence.
- No upstream copyright notice transfers ownership of Stephen Spittal's original NuBlox contributions.

## Provenance

- NuBlox repository: `https://github.com/NuBlox/NuBloxSQL`
- Upstream repository: `https://github.com/mysqljs/mysql`
- Upstream version at initial mastering: `2.18.1`
- Initial upstream commit: `dc9c152a87ec51a1f647447268917243d2eab1fd`
- Initial mastering date: `2026-09-26`
- Upstream licence: MIT (retained in `License` for inherited portions)
- NuBlox package identity: `@nublox/mysql`
- First NuBlox release-candidate line: `3.1.0-rc.x`

## Mastering model

`NuBlox/NuBloxSQL` is authoritative NuBlox source. It is not a mirror and it must never be automatically replaced from upstream.

NuBlox changes are normal first-class source changes reviewed and tested through NuBlox pull requests. The upstream licence and attribution remain intact for inherited upstream portions.

Upstream changes must be reviewed as immutable candidate commits and applied selectively through normal NuBlox pull requests rather than replacing the mastered codebase wholesale.

## Modern NuBlox foundation

The NuBlox evolution layer includes:

- Node.js 22+ runtime baseline;
- CommonJS callback compatibility plus first-class Promise and native ESM entry points;
- `connection.promise()` and `pool.promise()` wrappers;
- abort-aware Promise queries using `AbortSignal` semantics;
- async-iterable row streaming via `iterate()` and native stream backpressure;
- transaction orchestration through `withTransaction()`;
- opt-in retry for MySQL deadlocks and lock-wait timeouts with bounded exponential backoff and jitter;
- pool saturation, utilisation, health, warmup and minimum-idle maintenance capabilities;
- `diagnostics_channel` events for query timing, query failure, pool behaviour and transaction retry without publishing parameter values;
- built-in TypeScript declarations;
- modern MySQL authentication including `caching_sha2_password` and `sha256_password` flows;
- native prepared statements, bounded statement caching, typed binary parameters and binary result decoding;
- zlib and zstd transport compression;
- parser and PacketWriter allocation improvements backed by reproducible benchmarks and memory-soak profiling;
- standalone CI across supported Node.js versions and live MySQL 8.4/9.x versions.

`3.1.0-rc.1` begins the release-candidate stabilization phase. New feature scope is frozen for the RC line except where required to resolve release-blocking correctness, compatibility, security or packaging defects.

See `NUBLOX-MYSQL-ROADMAP.md` for the competitive capability programme and `docs/releases/3.1.0-rc.1.md` for the RC acceptance policy.
