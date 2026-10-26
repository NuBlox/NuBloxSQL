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
npm run qualify:mysql -- --iterations=120 --concurrency=4 --authAttempts=12 --durationMs=8000
npm run soak:mysql -- --durationMs=120000 --concurrency=4
# Optional competitor, installed OUTSIDE the published driver:
npm install --no-save --package-lock=false --ignore-scripts --prefix tools/qualification/mysql2-isolated mysql2@3.24.6
npm run compare:mysql -- --iterations=80 --rounds=4 --connections=8
```

Benchmarks measure **separate** workloads: native connection establishment
without application SQL, deliberately rejected authentication, a warmed
single-session prepared SELECT, bounded-pool callback SELECTs, one real
server-side cursor traversal, and reconnect churn (which includes a SQL
query). The bounded authentication burst also runs in soak mode, once per run,
not repeatedly throughout the soak. `--authAttempts=12` is the default and
can be set from 2 to 64, with at most `--concurrency` simultaneous attempts.
With **verified TLS**, half the attempts authenticate normally and half use
deliberately invalid credentials; rejected attempts must report MySQL error
1045 / SQLSTATE 28000. In **isolated-local plaintext** mode, every attempt
measures successful connection establishment only: a bad password can trigger
SHA-2 full authentication, which the driver deliberately refuses without
verified TLS. The report records `authRejectionProfile` as
`not-qualified-isolated-local` and `rejectedAuthentication.count=0` rather
than inventing invalid-password timings. The verified-TLS CI job explicitly
runs a benchmark that qualifies rejected authentication on the TLS fixture.
Each successful connection is closed by its worker, and the runner compares
MySQL's server-side `Threads_connected` before and after the burst. If active
sessions have not returned to baseline after bounded cleanup polling, the
qualification fails as a potential native resource leak. Soak executes a timed,
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

The optional **`compare:mysql`** command runs a bounded side-by-side
baseline against **mysql2 3.24.6**, installed only into
`tools/qualification/mysql2-isolated/node_modules`. It is never declared in
the published `@nublox/driver` runtime or workspace dependency manifests.
The comparison uses the **same MySQL 8.4 fixture and identical bound SQL**
(`SELECT ? AS benchmark_value`) for both clients. It measures fresh physical
connection establishment and a manually prepared statement executed repeatedly
on a persistent connection. Both clients receive eight untimed warmups per
statement, and numeric results are checked for correctness. The two clients
execute in alternating **ABBA** order across 2–12 rounds to reduce ordering
bias. Runs record package versions, Node/OS/CPU context, MySQL server version,
per-client p50/p95/p99, throughput, sample counts and durations as gitignored
JSON artifacts. `--iterations` ranges from 8 to 10,000 per round, and
`--connections` from 2 to 32 per round.

**Limitations:** This is a sequential, plaintext loopback-only *first*
comparison, not a certified benchmark or proof of superior performance.
It does not compare pooling, SQL parsing cost, TLS, cloud latency, parallel
throughput or memory profiles. Connection-only latency excludes close(), but
its reported operations/second includes close() between samples. Internal
implementations and an unpinned transitive comparator dependency tree may
influence results. The direct mysql2 version is fixed and checked at runtime.
For authoritative performance claims, pin the entire dependency graph,
execute multiple jobs on stable hardware and publish raw samples and
statistical uncertainty. CI checks **correctness and workload completion**,
not an arbitrary speed threshold.

These tests intentionally avoid writes and do not represent a full
transaction/DDL, failover, cloud IAM, multi-MySQL-version or multi-vendor
qualification suite. Check those separately before changing release status.
