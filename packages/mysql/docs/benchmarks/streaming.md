# Streaming benchmark

NuBloxSQL includes a reproducible live-server streaming comparison against `mysql2`.

Run it with:

```bash
npm run benchmark:mysql2:streaming
```

The benchmark runs the same recursive CTE and payload shape through both connectors using their callback-query streaming APIs. It reports per-round:

- total elapsed time;
- first-row latency;
- rows per second;
- payload MiB per second;
- settled RSS, heap, external and ArrayBuffer memory deltas;
- sampled peak RSS, heap, external and ArrayBuffer deltas.

## Configuration

| Environment variable | Default | Meaning |
| --- | ---: | --- |
| `BENCHMARK_ROWS` | `1000` | Rows consumed in each measured round. |
| `BENCHMARK_WARMUP_ROWS` | `min(rows, 128)` | Rows consumed before each measured round. |
| `BENCHMARK_ROUNDS` | `5` | Measured rounds per connector. |
| `BENCHMARK_PAYLOAD_BYTES` | `256` | UTF-8 bytes returned in the synthetic payload column for each row. |
| `BENCHMARK_HIGH_WATER_MARK` | `16` | Object-mode stream high-water mark supplied to both connectors. |
| `BENCHMARK_MEMORY_SAMPLE_EVERY` | `64` | Row interval used to sample peak process memory. |
| `MYSQL_HOST` | `127.0.0.1` | MySQL host. |
| `MYSQL_PORT` | `3306` | MySQL port. |
| `MYSQL_USER` | `root` | MySQL user. |
| `MYSQL_PASSWORD` | empty | MySQL password. |
| `MYSQL_DATABASE` | unset | Optional database. |

The benchmark raises `cte_max_recursion_depth` on each benchmark connection so row counts above MySQL's normal recursive-CTE default can be tested without changing global server configuration.

## Interpretation

Use multiple rounds on a dedicated host when comparing performance. The CI workload is intentionally a smoke test only: it verifies that the benchmark and both streaming paths execute correctly against supported MySQL releases, but it does not enforce a performance winner or regression threshold on shared hosted runners.

For memory comparisons, run Node with `--expose-gc` as the package script does. Peak memory values are sampled rather than continuously instrumented, which keeps the measurement overhead bounded and identical for both clients.
