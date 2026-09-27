# Bulk work benchmark

NuBloxSQL includes a reproducible live-server batched insert comparison against `mysql2`.

Run it with:

```bash
npm run benchmark:mysql2:bulk
```

The benchmark drives both connectors through the same callback `query()` path and the same transactional multi-row `INSERT` workload. Each measured round truncates an isolated temporary table, starts a transaction, inserts the configured row count in fixed-size batches, commits, and then verifies the final row count outside the measured interval.

Per round it reports:

- total elapsed time, including transaction start and commit;
- rows per second;
- batches per second;
- mean, p50, p95 and p99 batch latency;
- settled RSS, heap, external and ArrayBuffer memory deltas;
- sampled peak RSS, heap, external and ArrayBuffer deltas.

## Configuration

| Environment variable | Default | Meaning |
| --- | ---: | --- |
| `BENCHMARK_ROWS` | `5000` | Rows inserted in each measured round. |
| `BENCHMARK_WARMUP_ROWS` | `min(rows, batchSize * 2)` | Rows inserted and rolled back before each measured round. |
| `BENCHMARK_BATCH_SIZE` | `100` | Rows in each multi-value `INSERT`. |
| `BENCHMARK_ROUNDS` | `5` | Measured rounds per connector. |
| `BENCHMARK_PAYLOAD_BYTES` | `128` | ASCII payload bytes stored per row. |
| `MYSQL_HOST` | `127.0.0.1` | MySQL host. |
| `MYSQL_PORT` | `3306` | MySQL port. |
| `MYSQL_USER` | `root` | MySQL user. |
| `MYSQL_PASSWORD` | empty | MySQL password. |
| `MYSQL_DATABASE` | unset | Optional database. |

The temporary table uses InnoDB so the transaction and commit path is represented. Each connector gets its own session-local temporary table, which prevents one client from interfering with the other.

## Interpretation

Use multiple rounds on a dedicated host for performance conclusions. The CI workload is intentionally a correctness smoke test only; it demonstrates that both clients can execute the same batched transactional workload on supported MySQL versions but does not enforce a performance winner or regression threshold on shared hosted runners.

The benchmark includes client-side placeholder formatting because that work is part of the public callback `query()` path for both connectors. Row-count verification is deliberately excluded from the timed interval.
