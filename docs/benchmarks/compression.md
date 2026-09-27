# Compression benchmark

NuBloxSQL includes a live-server compression benchmark covering uncompressed, zlib and zstd transport.

Run it with:

```bash
npm run benchmark:mysql2:compression
```

The benchmark streams the same synthetic result set for every profile and reports per round:

- total elapsed time;
- rows per second;
- application payload MiB per second;
- settled RSS, heap, external and ArrayBuffer memory deltas.

## Comparability

Uncompressed and zlib profiles are run through both `@nublox/mysql` and `mysql2` using equivalent public connection options. The zstd profile is currently NuBlox-only because the pinned mysql2 comparison version does not expose an equivalent zstd transport option in this harness.

The workload measures end-to-end application-visible throughput, not raw on-the-wire byte counts. A compression profile may therefore trade CPU for reduced network traffic without that wire reduction appearing directly in the payload throughput figure.

## Configuration

| Environment variable | Default | Meaning |
| --- | ---: | --- |
| `BENCHMARK_ROWS` | `1000` | Rows consumed in each measured round. |
| `BENCHMARK_WARMUP_ROWS` | `min(rows, 128)` | Rows consumed before each measured round. |
| `BENCHMARK_ROUNDS` | `5` | Measured rounds per profile/client. |
| `BENCHMARK_PAYLOAD_BYTES` | `4096` | Repeated payload bytes returned per row. |
| `BENCHMARK_ZSTD_LEVEL` | `7` | NuBlox zstd compression level. |
| `MYSQL_HOST` | `127.0.0.1` | MySQL host. |
| `MYSQL_PORT` | `3306` | MySQL port. |
| `MYSQL_USER` | `root` | MySQL user. |
| `MYSQL_PASSWORD` | empty | MySQL password. |
| `MYSQL_DATABASE` | unset | Optional database. |

Use several rounds on a dedicated host for performance conclusions. CI deliberately runs a small smoke workload to verify the benchmark and transport paths execute correctly; it does not enforce a winner or regression threshold on shared hosted runners.
