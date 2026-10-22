# NuBloxSQL — native MySQL qualification runner

This directory is **release evidence infrastructure**, not proof of a commercial
release. No database credentials, query text, certificates or row contents are
persisted in JSON reports. A full production gate also requires version-matrix,
security, migration/compatibility, operational and comparative evidence.

## Running

Build the workspace with Node.js 22 and `npm install`. Use **only** an isolated
throwaway MySQL 8.4 database for this script. Set `NUBLOX_LIVE_MYSQL=1` and
`MYSQL_USER`, `MYSQL_PASSWORD`, `MYSQL_PORT` to target a test container;
optionally `MYSQL_DATABASE`. For verified TLS set
`NUBLOX_LIVE_MYSQL_TLS=1`, `MYSQL_TLS_PORT`, `NUBLOX_TLS_CA_FILE`, and
`MYSQL_USER` / `MYSQL_PASSWORD`. Never commit secrets.

```bash
npm run qualify:mysql -- --iterations=120 --concurrency=4 --durationMs=8000
npm run soak:mysql -- --durationMs=120000 --concurrency=4
```

Benchmarks run a warmup, then measure four **separate** workloads: a warmed
single-session prepared SELECT, bounded-pool callback SELECTs, one real
server-side cursor traversal, and reconnect churn. Soak executes a timed,
concurrent pooled read workload with periodic deliberate SQL errors that **must
not** destroy healthy sessions. Both check result correctness and pool bounds,
track p50/p95/p99 wall-clock latency, operations/s, RSS/heap peaks and event
loop delay, and write JSON to `artifacts/qualification/` (gitignored).
Each run records runtime platform, CPU count, Node version, vendor version,
duration, concurrency, and git SHA. These are **not comparable numbers without
identical hardware, driver versions, MySQL configuration, network and workload**.

CI's ordinary PR job runs a short qualification smoke with strict **zero errors
and state/capacity checks**, not numeric performance thresholds (shared-host
noise makes thresholds misleading). Nightly and manual GitHub workflows run
longer soak and attach the JSON evidence. The one-million-operation safety ceiling is designed not to truncate an ordinary two-minute run; reports record the **actual** elapsed duration, and a run hitting the ceiling early is not evidence of a full-duration soak. The timer ends *between* operations;
outstanding work completes, so actual duration may be slightly longer.

The current benchmark compares **NuBloxSQL to itself across commits**; it does
not measure mysql2, mysqljs/mysql or any commercial alternative and therefore
cannot prove leadership. No results contain synthetic performance claims.
For comparative benchmarking, implement an identical competitor adapter and
publish a pinned environment and reproducible raw result artifacts.

These tests intentionally avoid writes and do not represent a full
transaction/DDL, failover, cloud IAM, multi-MySQL-version or multi-vendor
qualification suite. Check those separately before changing release status.
