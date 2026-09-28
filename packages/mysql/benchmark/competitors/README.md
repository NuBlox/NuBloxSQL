# Competitor benchmarks

These benchmarks compare NuBloxSQL with current Node.js MySQL clients under the same process, server and query workload.

They are evidence tools, not marketing claims. A benchmark result is meaningful only when the environment, server version, Node.js version, warm-up count and iteration count are recorded with it.

## mysql2 sequential query benchmark

The first benchmark compares `@nublox/mysql` with the pinned mysql2 compatibility reference using repeated `SELECT 1 AS value` queries over one established connection.

```bash
MYSQL_HOST=127.0.0.1 \
MYSQL_PORT=3306 \
MYSQL_USER=root \
MYSQL_PASSWORD=secret \
MYSQL_DATABASE=test \
BENCHMARK_WARMUP=100 \
BENCHMARK_ITERATIONS=1000 \
npm run benchmark:mysql2
```

The command emits JSON containing elapsed time, throughput, mean latency and p50/p95/p99 latency for each client.

## Rules

1. Run every compared client against the same MySQL instance.
2. Pin competitor versions in `package.json` and `compatibility/mysql2.json`.
3. Do not publish a winner from a single run.
4. Record Node.js, MySQL, operating system and hardware details when publishing results.
5. Keep benchmark code in this repository so results can be reproduced.
6. Add workloads for prepared statements, pools, concurrency, bulk operations, streaming and memory before making broad performance claims.
