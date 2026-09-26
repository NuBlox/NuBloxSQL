# NuBlox MySQL Connector — Competitive Engineering Roadmap

## Objective

Build `@nublox/mysql` into a production-grade MySQL integration that exceeds the practical developer, reliability, security, observability and operations capabilities of current Node.js MySQL connectors while retaining a migration path from the `mysqljs/mysql` and mysql2 APIs.

This is an engineering programme, not a claim that the first NuBlox revision already leads every competitor in every dimension.

## Compatibility programme

mysql2 compatibility is measured continuously rather than claimed broadly. The machine-readable source of truth is `compatibility/mysql2.json`, with executable contract and live-server evidence under `test/compatibility/mysql2/`.

A capability moves to `supported` only when repository evidence exists and CI validates it. `partial` means NuBlox has related capability but does not yet promise mysql2-compatible behaviour. `planned` means applications must not rely on migration compatibility for that feature yet.

The first pinned mysql2 compatibility reference is `3.24.4` (reviewed 2026-09-26).

## Baseline review

The mastered `mysqljs/mysql` 2.18.1 baseline has strong callback compatibility and a mature classic-protocol parser, but its original configuration explicitly disables compression, connection attributes and plugin authentication. It also predates modern Promise-first Node.js application patterns, current LTS runtimes and built-in TypeScript declarations.

Current competitor capability floors include:

| Capability | mysqljs/mysql 2.18.1 baseline | MySQL2 3.x | MariaDB Connector/Node.js 3.5 | NuBlox programme |
| --- | --- | --- | --- | --- |
| Promise / async-await API | No | Yes | Yes | Implemented |
| TypeScript declarations | No | Yes | Yes | Implemented; parity programme ongoing |
| Prepared statements / binary protocol | No | Yes | Yes | Native `execute()` and explicit `prepare()` implemented and live-tested |
| Prepared statement cache | No | LRU | Yes | Bounded LRU implemented with stats and diagnostics |
| Named placeholders | No built-in parity target | Yes | Connector-specific | Implemented for query/execute with mysql2-compatible opt-in semantics |
| Modern auth plugins | Partial auth switch, native password only | Yes | Yes | Implemented and live-tested |
| Compression | Explicitly disabled | Yes | Yes | M4 |
| Connection/query attributes | Explicitly disabled | Yes | Connector-specific | Planned with trace propagation |
| AbortSignal cancellation | No first-class API | Limited connector-specific patterns | Connector-specific | Implemented for Promise connection queries |
| Transaction callback orchestration | No | Application-managed | Application-managed helpers vary | Implemented |
| Deadlock/lock-timeout transaction retry | No | Application-managed | Application-managed | Implemented, opt-in |
| Pool utilisation/saturation metrics | Internal arrays only | Limited public operational surface | Pool metrics vary | Implemented |
| Health-check result surface | No | Application-managed | Application-managed | Implemented |
| diagnostics_channel telemetry | No | Tracing channels | No equivalent baseline assumption | Implemented |
| Async iteration over row stream | Stream only | Stream support | Stream support | Implemented via Node async iteration |
| Resource-bound hostile-server defence | Legacy limits | Evolving | `maxAllowedColumns` and related controls | M5 |
| Binary log / CDC protocol | No | Yes | Separate ecosystem | M7 |

## Engineering principles

1. **Secure by default.** TLS verification remains enabled by default. Unsafe compatibility switches must be explicit.
2. **No silent upstream overwrite.** Upstream is reference input, never authority over mastered NuBlox source.
3. **Protocol correctness before API sugar.** Prepared statements, authentication and server capability negotiation are implemented at packet level and verified against supported MySQL versions.
4. **Cancellation has explicit semantics.** When a protocol operation cannot be safely cancelled in-band, the connector terminates the affected connection rather than pretending cancellation succeeded.
5. **Retries are opt-in.** Transaction retries can repeat application code, so the default is zero retries. Callers explicitly choose retry behaviour.
6. **Observability excludes bind values by default.** Diagnostics publish statement templates, timings, connection identifiers and error codes, not parameter values.
7. **Bound every server-controlled allocation.** Column counts, packet sizes, prepared statement metadata, queue sizes and buffers will have enforceable limits.
8. **Compatibility is measured.** mysql/mysql2-compatible behaviour must have executable evidence; unsupported behaviour remains explicit.
9. **Benchmarks are reproducible evidence.** Results record environment and workload and never claim a universal winner from one run.

## Delivery sequence

### M1 — Modern application surface — implemented

- Node.js >=22 baseline.
- Promise entry point and wrapper APIs.
- AbortSignal-aware connection queries.
- Async iteration over query streams.
- TypeScript declarations.
- Transaction helper with optional deadlock/lock-wait retry.
- Pool health and saturation metrics.
- Diagnostics channels.
- CI on Node 22, 24 and current Node 26.
- mysql2 API contract test foundation.
- mysql2 live query/pool/transaction parity tests.
- machine-readable compatibility capability manifest.
- reproducible mysql2 benchmark foundation.

### M2 — Current MySQL authentication — implemented

- `caching_sha2_password` fast authentication.
- Secure full authentication over TLS.
- RSA public-key exchange for explicitly allowed non-TLS full authentication.
- `sha256_password` and pluggable auth-provider support.
- Tests against MySQL 8.4 and MySQL 9.x server lines.

Connection and query attributes remain planned separately and are not considered complete as part of M2.

### M3 — Prepared statements and binary protocol — in progress

Delivered:

- native `COM_STMT_PREPARE`, `COM_STMT_EXECUTE` and `COM_STMT_CLOSE` flow;
- binary parameter encoding for common JavaScript value types;
- binary result decoding for core MySQL type families;
- callback and Promise `execute()` APIs on connections and pools;
- bounded per-connection LRU prepared-statement cache;
- mysql2-compatible `maxPreparedStatements`, including `0` to disable caching;
- explicit `unprepare()` and cache-clear controls;
- cache hit/miss/eviction/reprepare statistics and diagnostics events;
- one-shot recovery from `ER_NEED_REPREPARE` and invalid statement handles;
- atomic prepare/execute queue ordering under concurrent commands;
- explicit connection-scoped `prepare()` statement objects for callback and Promise APIs;
- reusable manual statement `execute()` and `close()` lifecycle;
- manual statement invalidation guards across `close()` and `changeUser()`;
- manual statement lifecycle diagnostics without bind values;
- prepared APIs on physical connections acquired from pools;
- mysql2-compatible named placeholders for text query and `execute()` paths;
- connection-wide and per-operation named-placeholder enable/disable behaviour;
- positional `?` fallback when arrays are supplied with named placeholders enabled;
- mysql2-compatible execute, manual-prepare and named-placeholder surface checks;
- live prepared-execute, cache, manual-lifecycle and named-placeholder tests against MySQL 8.4 and 9.x.

Remaining M3 work:

- `COM_STMT_RESET` where needed;
- exact typed-parameter controls for integer width, signedness and binary/text intent;
- broader binary-protocol type and edge-case coverage;
- prepared-statement performance benchmarks.

### M4 — Performance and transport

- MySQL compression protocol with modern algorithms where server support permits.
- Parser allocation profiling and buffer reuse.
- Configurable high-water marks and backpressure tests.
- Connection warm-up and pool minimum-idle controls.
- Query pipelining research with protocol-ordering safety constraints.
- Expand the reproducible benchmark harness to prepared statements, pools, concurrency, streaming, bulk work and memory.

### M5 — Enterprise resilience and security

- Hard maximum packet, column, metadata and row-allocation controls.
- Per-operation deadlines composed with AbortSignal.
- Circuit-breaker and adaptive pool admission hooks at the NuBlox integration layer.
- Credential-provider interface for short-lived secrets.
- TLS profile policy with minimum-version enforcement.
- SAST, dependency audit and fuzzing of packet/parser boundaries.

### M6 — Observability and distributed tracing

- OpenTelemetry adapter built on the zero-dependency diagnostics channels.
- W3C trace-context to MySQL query attributes where supported.
- Pool wait histograms, query duration, error classification and retry metrics.
- Slow-query event policy without leaking bind values.

### M7 — Advanced MySQL platform features

- Binary log / CDC client.
- Server-side cursor and streaming prepared results where protocol support permits.
- Read/write routing hooks using server role and replication state.
- Session-state tracking and safe reset.
- Multi-host topology discovery and failover policy interfaces.

## Competitive acceptance criteria

NuBlox should not describe this package as the leading Node.js MySQL connector until automated evidence demonstrates:

- current-server authentication compatibility;
- prepared-statement correctness and cache behaviour;
- competitive throughput and latency under controlled benchmarks;
- bounded memory behaviour under hostile or malformed server responses;
- pool recovery and failover behaviour under network faults;
- no known high-severity dependency or SAST findings in the supported release;
- stable TypeScript and Promise APIs;
- documented migration tests from mysqljs/mysql and mysql2-compatible call patterns where promised.

## External references used for the capability review

- MySQL2 project and documentation: `https://github.com/sidorares/node-mysql2` and `https://sidorares.github.io/node-mysql2/`
- MySQL Connector/Node.js documentation: `https://dev.mysql.com/doc/dev/connector-nodejs/latest/`
- MariaDB Connector/Node.js resources: `https://mariadb.com/docs/connectors/mariadb-connector-nodejs/`
- Node.js release status: `https://nodejs.org/en/about/previous-releases`
