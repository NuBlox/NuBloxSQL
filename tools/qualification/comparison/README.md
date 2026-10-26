# Concurrent native MySQL comparator extension

The existing `npm run compare:mysql` baseline (PR #389) tests connection
setup and serial prepared execution against isolated mysql2. This extension
adds **concurrent** work using dedicated native sessions, without modifying
that baseline or the production driver.

## Run

With an isolated disposable MySQL 8.4 service on `127.0.0.1:3306` and
`NUBLOX_LIVE_MYSQL=1` (plus optional `MYSQL_PORT`, `MYSQL_USER`,
`MYSQL_PASSWORD` and `MYSQL_DATABASE`):

```bash
npm install --no-save --package-lock=false --ignore-scripts --prefix tools/qualification/mysql2-isolated mysql2@3.24.6
npm run build
node tools/qualification/compare-concurrent.mjs --iterations=48 --concurrency=4 --rounds=4
```

Each vendor uses the same bound `SELECT ? AS value`, exact input sequence,
eight untimed executions per explicitly prepared statement, and verifies
every result. `preparedSequential` uses one session; `preparedConcurrent`
uses N **dedicated sessions**, each with its own prepared statement, avoiding
unequal vendor-pooling/reset semantics. `connectionOnly` measures opening
the socket (including authentication) separately; its wall-clock throughput
includes closing sockets. The two client orders reverse in alternating
rounds. Reports include per-round count, p50/p95/p99, wall-clock throughput,
Node/OS/CPU, pinned mysql2 version, MySQL server version and Git SHA.
No credentials, SQL text, error messages or result rows appear in reports.

CLI bounds are 4–2000 measured operations per workload/client/round,
1–8 concurrent connections and 2–8 alternating rounds. The GitHub smoke job
uses much smaller settings to validate correctness and cleanup.

**Caution:** Shared CI timing is diagnostic only. All workloads currently
use a single local MySQL 8.4 server and plaintext loopback, and measure
neither vendor-specific pools nor TLS, cloud latency, sustained memory, nor
the multi-version matrix. Relative performance needs repeated measurements
on identical dedicated hardware, full dependency locks, confidence intervals
and a broader workload mix before a commercial claim is defensible. No
third-party comparator is bundled with `@nublox/driver`.
