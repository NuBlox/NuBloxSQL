# Prepared statement benchmark

NuBloxSQL benchmarks are evidence tools, not universal performance claims. Results depend on CPU, operating system, Node.js version, MySQL version, network topology, server configuration and workload.

## Workload

`benchmark/competitors/mysql2-prepared.js` compares `@nublox/mysql` with the pinned mysql2 development dependency using the same server and SQL shape:

```sql
SELECT ? AS value
```

Each client runs sequential prepared executions so both connectors can exercise their prepared-statement reuse path. The default run uses:

- 500 warm-up executions;
- 5,000 measured executions per round;
- 5 measured rounds per client;
- one physical connection per client.

The JSON result records Node.js, platform and architecture together with throughput, mean latency, p50/p95/p99 latency and process-memory deltas for every round.

## Run

Start a supported MySQL server, install dependencies and run:

```bash
MYSQL_HOST=127.0.0.1 \
MYSQL_PORT=3306 \
MYSQL_USER=root \
MYSQL_PASSWORD=secret \
MYSQL_DATABASE=test \
npm run benchmark:mysql2:prepared
```

Override the workload with:

```bash
BENCHMARK_WARMUP=1000 \
BENCHMARK_ITERATIONS=10000 \
BENCHMARK_ROUNDS=10 \
npm run benchmark:mysql2:prepared
```

The npm command starts Node.js with `--expose-gc` so garbage collection can be requested immediately before and after each measured round. Memory deltas remain process-level observations rather than precise per-query allocation measurements.

## Interpretation

Do not compare a single round or report a universal winner from this benchmark. Use multiple runs on otherwise idle, fixed hardware and compare the distribution of rounds. Record MySQL configuration and server version alongside any published result.

Performance work should be accepted only when it preserves the protocol-correctness and compatibility suites. A throughput improvement that weakens result correctness, lifecycle safety or bounded-resource behaviour is a regression.
