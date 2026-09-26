# NuBlox Mastered Package — MySQL

This directory is the NuBlox-owned evolution of the `mysqljs/mysql` Node.js MySQL driver.

## Provenance

- Upstream repository: `https://github.com/mysqljs/mysql`
- Upstream version at initial mastering: `2.18.1`
- Initial upstream commit: `dc9c152a87ec51a1f647447268917243d2eab1fd`
- Initial mastering date: `2026-09-26`
- Upstream licence: MIT (retained as `License`)
- NuBlox package identity: `@nublox/mysql`

## Mastering model

`packages/mastered/mysql` is authoritative NuBlox source. It is not a mirror and it must never be automatically replaced from upstream.

NuBlox changes are normal first-class source changes reviewed and tested through NuBlox pull requests. The upstream licence and attribution remain intact.

The `Review MySQL upstream candidate` workflow accepts an immutable 40-character upstream commit SHA, downloads that source into an isolated runner directory, and publishes a candidate snapshot plus diff artifacts. It has read-only repository permissions and cannot modify the mastered package. Upstream changes are applied selectively through a normal NuBlox pull request.

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
- dedicated CI on supported LTS and current Node.js lines.

See `NUBLOX-MYSQL-ROADMAP.md` for the competitive capability programme.
