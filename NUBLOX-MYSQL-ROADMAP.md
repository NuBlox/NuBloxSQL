# NuBlox MySQL Roadmap

## Purpose

NuBloxSQL is evolving `@nublox/mysql` into a modern, production-oriented MySQL connector for current Node.js and MySQL releases while retaining a pragmatic migration path from established callback and mysql2-style APIs.

The roadmap is evidence-driven: capabilities are promoted only when executable tests, live-server validation or reproducible benchmarks demonstrate them.

## Competitive capability baseline

Current competitor capability floors include:

| Capability | Legacy mysql | mysql2 | Modern connectors | NuBloxSQL |
| --- | --- | --- | --- | --- |
| Promise API | No | Yes | Usually | Implemented |
| Native ESM | No | Yes | Usually | Implemented |
| TypeScript declarations | Community | Yes | Usually | Implemented, parity expanding |
| Modern SHA-2 auth | Partial | Yes | Yes | Implemented and live-tested |
| Native prepared statements | No | Yes | Usually | Implemented |
| Prepared statement cache | No | LRU | Yes | Bounded LRU implemented with stats and diagnostics |
| Named placeholders | No built-in parity target | Yes | Connector-specific | Implemented for query/execute with mysql2-compatible opt-in semantics |
| Compression | Explicitly disabled | Yes | Yes | zlib + zstd implemented and live-tested |
| Connection/query attributes | Explicitly disabled | Yes | Connector-specific | Planned with trace propagation |
| AbortSignal cancellation | No first-class API | Limited connector-specific patterns | Connector-specific | Implemented for Promise connection queries |
| Transaction callback orchestration | No | Application-managed | Application-managed helpers vary | Implemented |
| Pool observability | Private state | Limited public surface | Varies | Public stats, health checks, warmup and maintenance diagnostics |

## Milestones

### M1 — Modern application surface — implemented

Delivered:

- Node.js >=22 baseline;
- Promise entry point and callback-to-Promise wrappers;
- `connection.promise()` and `pool.promise()` compatibility;
- AbortSignal-aware Promise text queries;
- async iterable result consumption;
- TypeScript declarations;
- `withTransaction()` with opt-in deadlock/lock-wait retries;
- public pool health and saturation statistics;
- `diagnostics_channel` query, pool and transaction events without bind values;
- CI across Node 22, 24 and 26;
- mysql2 API contract foundation;
- mysql2 live query, pool and transaction parity;
- machine-readable compatibility manifest;
- reproducible mysql2 benchmark foundation;
- native CommonJS and ESM entry points.

### M2 — Current MySQL authentication — implemented

Delivered:

- `caching_sha2_password` fast authentication;
- secure full authentication over TLS;
- explicit RSA non-TLS full authentication;
- trusted server public-key pinning and opt-in key retrieval;
- `sha256_password` and pluggable authentication support;
- live MySQL 8.4 and 9.x authentication validation.

Connection/query attributes remain planned separately and are not considered part of authentication completion.

### M3 — Prepared statements and binary protocol — implemented

Delivered:

- native `COM_STMT_PREPARE`, `COM_STMT_EXECUTE`, `COM_STMT_RESET` and `COM_STMT_CLOSE`;
- callback and Promise `execute()` on connections and pools;
- explicit `prepare()` / statement lifecycle with execute/reset/close;
- binary parameter encoding for common JavaScript values;
- bounded per-connection LRU prepared-statement cache;
- mysql2-compatible `maxPreparedStatements`, including `0` to disable caching;
- explicit `unprepare()` and cache clearing;
- cache stats and diagnostics events without bind values;
- one-shot safe reprepare for stale server-side statement handles;
- atomic prepare/execute command ordering;
- named-placeholder compatibility for query and execute;
- explicit typed prepared-parameter constructors for signed and unsigned 8/16/32/64-bit integers, float/double, exact decimal, text and binary intent;
- protocol-native DATE, DATETIME, TIMESTAMP and TIME parameters with microsecond precision and negative multi-day TIME support;
- native JSON prepared parameters;
- BIT and YEAR semantic parameter constructors with legal MySQL execute wire types;
- range validation and safe 64-bit input rules, with direct wire-byte and `COM_STMT_EXECUTE` metadata tests;
- binary result decoding and live coverage for signed/unsigned numeric families, BIGINT boundaries, DECIMAL, FLOAT/DOUBLE, YEAR, DATE/DATETIME/TIMESTAMP/TIME with fractional seconds, BIT, BINARY/VARBINARY/BLOB, TEXT, JSON, ENUM, SET, GEOMETRY and NULL bitmap handling;
- consistent GEOMETRY decoding between text and prepared/binary protocols;
- selective `dateStrings` matching corrected and covered;
- live typed-parameter and binary-result matrix testing against MySQL 8.4 and 9.x;
- reproducible mysql2 prepared-statement benchmark with throughput, percentile latency and memory-delta evidence;
- mysql2-compatible execute, manual-prepare and named-placeholder surface checks;
- live prepared-execute, cache, manual-lifecycle, reset-lifecycle and named-placeholder tests against MySQL 8.4 and 9.x.

### M4 — Performance and transport — in progress

Delivered:

- zlib connection-compression policy through `compressionAlgorithms`, with explicit uncompressed fallback;
- mysql2-style `compress: true` compatibility mapped to `zlib` then `uncompressed`;
- capability-gated `CLIENT_COMPRESS` negotiation rather than unsafe raw-flag forcing;
- zstd negotiation through `CLIENT_ZSTD_COMPRESSION_ALGORITHM` with explicit Node runtime feature detection;
- ordered `zstd`, `zlib`, `uncompressed` policy and configurable zstd levels in MySQL's supported 1–22 range;
- MySQL seven-byte compressed-packet framing, compressed sequence validation and transparent reinjection into the classic packet parser;
- bounded zlib/zstd decompression to the server-declared uncompressed frame size;
- uncompressed compressed-frames when compression would expand a payload;
- strict failure when required compression cannot be mutually negotiated;
- live zlib and zstd transport validation against MySQL 8.4 and 9.x with large client-to-server and server-to-client payloads;
- amortized O(1) parser pending-buffer dequeue using a head-index FIFO with bounded compaction instead of `Array.shift()` reindexing;
- single-buffer parser completion fast path that avoids temporary array allocation while preserving retained-prefix and multi-buffer semantics;
- reproducible parser-fragmentation benchmark with CI smoke coverage across tiny and large network chunk sizes;
- geometric `PacketWriter` capacity growth to avoid repeated linear-growth payload copies;
- direct payload copying during final packet framing to avoid per-packet temporary slice allocation;
- reproducible PacketWriter allocation benchmark with CI smoke coverage;
- native Node stream backpressure with explicit high-water-mark behaviour and live-server validation;
- validated `minimumIdle` pool target with explicit callback and Promise `warmup()` APIs;
- capacity-aware warm-up that respects `connectionLimit`, reuses existing idle connections and hands new connections to queued demand;
- concurrent warm-up coordination so overlapping callers share in-flight connection creation;
- optional continuous minimum-idle maintenance after explicit configured warmup;
- bounded exponential reconnect backoff with configurable jitter for minimum-idle maintenance;
- unref'd maintenance timers and shutdown cleanup;
- minimum-idle start/end/error diagnostics without credentials or bind values;
- live pool warm-up and minimum-idle maintenance validation against MySQL 8.4 and 9.x;
- reproducible mysql2 pool-concurrency benchmark with throughput, percentile latency and memory-delta evidence;
- reproducible mysql2 streaming benchmark with first-row latency, rows/sec, payload throughput and sampled peak/settled memory evidence, plus live MySQL 8.4/9.x CI smoke coverage;
- reproducible mysql2 transactional bulk-insert benchmark with configurable batching, rows/sec, batch throughput/latency and sampled peak/settled memory evidence, plus live MySQL 8.4/9.x CI smoke coverage;
- reproducible transport-compression benchmark covering uncompressed and zlib parity against mysql2 plus NuBlox zstd, with throughput and settled-memory evidence and live MySQL 8.4/9.x CI smoke coverage.

Remaining M4 work:

- continue parser/output allocation profiling and buffer-reuse opportunities using benchmark evidence;
- query pipelining research with protocol-ordering safety constraints;
- deepen long-duration and peak-memory profiling across representative workloads.

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
- bounded resource behaviour under malformed and adversarial inputs;
- predictable pool behaviour under saturation, failures and recovery;
- usable tracing and metrics without leaking SQL bind values;
- documented migration paths from widely used Node.js MySQL connectors.

The compatibility manifest and reproducible benchmark suite are the evidence sources for these claims.
