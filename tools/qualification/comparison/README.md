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

## Paired-round variance analysis

The concurrent comparison report now includes an `analysis` section in
addition to the unchanged individual `trials`. It compares **matched
client results within each numbered round**, not unrelated samples from
different rounds. For each workload it calculates:

- The ratio of round **p50 latency**: `NuBloxSQL p50 ms / mysql2 p50 ms`.
  A value below 1 means NuBloxSQL had lower *observed* median latency in
  that round; above 1 means mysql2 had lower observed latency. This is not
  a percentage of operations or a guaranteed performance advantage.
- Median and geometric mean across round ratios; range and coefficient of
  variation to expose round-to-round instability.
- How many paired rounds favour either client (ties favour neither).
- Separate geometric means when NuBloxSQL runs first or mysql2 runs first,
  so consistent warmup/order effects remain visible.
- Per-round p50 and p95 ratios and the execution order, retained for audit.

**Statistical limitation:** the CI correctness smoke uses only 2 rounds and
sets `levelOfEvidence=insufficient-for-interval`, with a null confidence
interval. At 6–8 rounds the runner adds a fixed-seed, 4096-replicate paired
round bootstrap interval around the **geometric mean p50 ratio**, labelled
`exploratory95Interval`. Resampling *entire paired rounds* avoids treating
correlated query operations as independent evidence. It still cannot remove
shared-runner noise, server contention, CPU scaling or temporal drift.
These small-sample intervals are exploratory **not** a formal proof of
significant improvement or commercial superiority.

For a larger local exploratory sample use:

```bash
node tools/qualification/compare-concurrent.mjs \
  --iterations=500 --concurrency=4 --rounds=8
```

Record multiple separate runs on dedicated, consistent hardware and review
the retained JSON trial distributions, order sensitivity and environment
before proposing a specific driver optimisation. Ratios cannot by themselves
identify which internal function is the bottleneck; follow up with independent
profiling of packet parsing, result decoding and scheduling.
