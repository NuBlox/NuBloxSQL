# NuBlox MySQL Connector — Competitive Engineering Roadmap

## Objective

Build `@nublox/mysql` into a production-grade MySQL integration that exceeds the practical developer, reliability, security, observability and operations capabilities of current Node.js MySQL connectors while retaining a migration path from the `mysqljs/mysql` API.

This is an engineering programme, not a claim that the first NuBlox revision already leads every competitor in every dimension.

## Baseline review

The mastered `mysqljs/mysql` 2.18.1 baseline has strong callback compatibility and a mature classic-protocol parser, but its original configuration explicitly disables compression, connection attributes and plugin authentication. It also predates modern Promise-first Node.js application patterns, current LTS runtimes and built-in TypeScript declarations.

Current competitor capability floors include:

| Capability | mysqljs/mysql 2.18.1 baseline | MySQL2 3.x | MariaDB Connector/Node.js 3.5 | NuBlox programme |
| --- | --- | --- | --- | --- |
| Promise / async-await API | No | Yes | Yes | Implemented |
| TypeScript declarations | No | Yes | Yes | Implemented |
| Prepared statements / binary protocol | No | Yes | Yes | Next protocol milestone |
| Prepared statement cache | No | LRU | Yes | Planned adaptive bounded cache |
| Modern auth plugins | Partial auth switch, native password only | Yes | Yes | Next protocol milestone |
| Compression | Explicitly disabled | Yes | Yes | Planned |
| Connection/query attributes | Explicitly disabled | Yes | Connector-specific | Planned with trace propagation |
| AbortSignal cancellation | No first-class API | Limited connector-specific patterns | Connector-specific | Implemented for Promise connection queries |
| Transaction callback orchestration | No | Application-managed | Application-managed helpers vary | Implemented |
| Deadlock/lock-timeout transaction retry | No | Application-managed | Application-managed | Implemented, opt-in |
| Pool utilisation/saturation metrics | Internal arrays only | Limited public operational surface | Pool metrics vary | Implemented |
| Health-check result surface | No | Application-managed | Application-managed | Implemented |
| diagnostics_channel telemetry | No | Tracing channels | No equivalent baseline assumption | Implemented |
| Async iteration over row stream | Stream only | Stream support | Stream support | Implemented via Node async iteration |
| Resource-bound hostile-server defence | Legacy limits | Evolving | `maxAllowedColumns` and related controls | Planned security milestone |
| Binary log / CDC protocol | No | Yes | Separate ecosystem | Planned |

## Engineering principles

1. **Secure by default.** TLS verification remains enabled by default. Unsafe compatibility switches must be explicit.
2. **No silent upstream overwrite.** Upstream is reference input, never authority over mastered NuBlox source.
3. **Protocol correctness before API sugar.** Prepared statements, modern authentication and server capability negotiation are implemented at packet level and verified against supported MySQL versions.
4. **Cancellation has explicit semantics.** When a protocol operation cannot be safely cancelled in-band, the connector terminates the affected connection rather than pretending cancellation succeeded.
5. **Retries are opt-in.** Transaction retries can repeat application code, so the default is zero retries. Callers explicitly choose retry behaviour.
6. **Observability excludes bind values by default.** Diagnostics publish statement templates, timings, connection identifiers and error codes, not parameter values.
7. **Bound every server-controlled allocation.** Column counts, packet sizes, prepared statement metadata, queue sizes and buffers will have enforceable limits.
8. **Compatibility is measured.** Callback compatibility is retained where practical, but obsolete Node runtime compatibility does not constrain the NuBlox design.

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

### M2 — Current MySQL authentication and capability negotiation

- Enable `CLIENT_PLUGIN_AUTH` and connection attributes.
- `caching_sha2_password` fast authentication.
- Secure full authentication over TLS.
- RSA public-key exchange for explicitly allowed non-TLS full authentication.
- `sha256_password` and pluggable auth-provider API.
- Tests against currently supported MySQL server lines.

### M3 — Prepared statements and binary protocol

- `COM_STMT_PREPARE`, execute, reset and close.
- Binary parameter/result encoding.
- `execute()` Promise and callback APIs.
- Bounded LRU statement cache with telemetry and explicit invalidation.
- Typed parameters for exact integer width, signedness and binary/text intent.

### M4 — Performance and transport

- MySQL compression protocol with modern algorithms where server support permits.
- Parser allocation profiling and buffer reuse.
- Configurable high-water marks and backpressure tests.
- Connection warm-up and pool minimum-idle controls.
- Query pipelining research with protocol-ordering safety constraints.
- Reproducible benchmark harness against MySQL2 and MariaDB Connector/Node.js.

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
- documented migration tests from mysqljs/mysql and MySQL2-compatible call patterns where promised.

## External references used for the capability review

- MySQL2 project and documentation: `https://github.com/sidorares/node-mysql2` and `https://sidorares.github.io/node-mysql2/`
- MySQL Connector/Node.js documentation: `https://dev.mysql.com/doc/dev/connector-nodejs/latest/`
- MariaDB Connector/Node.js resources: `https://mariadb.com/docs/connectors/mariadb-connector-nodejs/`
- Node.js release status: `https://nodejs.org/en/about/previous-releases`
