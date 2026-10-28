# NuBloxSQL — native MySQL qualification runner

This directory is **release evidence infrastructure**, not proof of a commercial
release. No database credentials, query text, certificates or row contents are
persisted in JSON reports. A full production gate also requires version-matrix,
security, migration/compatibility, operational and comparative evidence.

## Current LTS verified-TLS qualification and evidence integrity

The [current-release CI workflow](../../.github/workflows/mysql-current-support.yml)
adds certificate-verified, TLS-required MySQL `8.4.13` and `9.7.4` jobs
alongside the local TCP `8.4.13`, `9.7.4`, `26.10.0` matrix.
The TLS fixture uses temporary CA and hostname-verified certificates,
rejects unpinned image versions, executes the complete native TLS suite,
and requires actual negative-authentication and resource evidence.

The `mysql-current-qualification-evidence` gate downloads those five
independent artifact groups and validates exactly **11 reports** from the
same commit and runner profile. Reuse the validator locally with
`NUBLOX_MYSQL_MATRIX_PROFILE=current node tools/qualification/verify-matrix-evidence.mjs <artifact-dir>`
after setting `GITHUB_RUN_ID`, `GITHUB_SHA` and `GITHUB_EVENT_NAME`.
The default profile remains `legacy` for MySQL 8.0.44 and 8.4.11.
Missing, wrong-version, failed, incomplete-duration and cross-revision
evidence cannot pass. MySQL `26.10.0` has **no TLS qualification** in
this phase; the summary records `not-qualified` rather than claiming
coverage from plaintext-only tests.

## Repeated server outages and extended pool endurance

See [repeated MySQL outage and endurance qualification](../../docs/MYSQL-RESILIENCE-QUALIFICATION.md).
The dedicated `mysql-resilience.yml` workflow runs two controlled
server crashes per PR/main check (six when scheduled or manually dispatched),
exercises twelve simultaneous borrowers against a strict two-connection
pool before and after each restart, and retains every original
`mysql-restart` artifact plus its aggregate redacted summary.
`mysql-repeated-outage-evidence` independently validates every crash,
pool-disposal invariant and exact commit; missing/duplicate cycles fail.

A separate 30-minute weekly pooled soak, and optional one/two-hour
manual soak, preserve elapsed-duration, expected error recovery,
observed memory peaks and zero native pool capacity after close.
The two-hour configuration is **not** proof of a completed two-hour run.
Neither script may be aimed at shared or production databases.

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


## Version matrix and destructive server-restart qualification

[MySQL version and restart recovery CI](../../.github/workflows/mysql-version-qualification.yml)
tests two fixed MySQL Docker image tags: `8.0.44` and `8.4.11`.
Each isolated job loads the conformance SQL, executes the full
`npm test` suite against that server, runs a short prepared/cursor/pool/
authentication smoke and a timed soak. Weekly runs use a two-minute
soak per version; PR and main-push runs use a five-second safety smoke.
The existing nightly 8.4.11 sustained workflow remains separate.

After workload qualification, the dedicated CI-only
`tools/qualification/mysql-restart-recovery.mjs` opens a real prepared
statement, parks a connection in a bounded pool, starts an actual
`SELECT SLEEP(?)` native request, and **SIGKILLs** its isolated server
container. It verifies the pending command returns `CONNECTION_CLOSED`,
the prepared handle and native session are revoked, the original command
was not replayed, and a restarted MySQL service is reachable only through
a fresh pool connection. A failing assertion or cleanup fails the job.

**Destructive test:** the runner requires `CI=true`, an explicit
`NUBLOX_ALLOW_DESTRUCTIVE_MYSQL_FIXTURE=1` flag, `NUBLOX_LIVE_MYSQL=1`,
an actual Docker container ID and an image exactly matching the selected
`mysql:<version>` tag. The workflow supplies these values only for its
throwaway MySQL service. Never point this runner at production, shared
development or customer services. No credentials, SQL, row values or
native connection IDs are persisted in evidence reports.

Each matrix job uploads mode- and version-specific redacted JSON under
`artifacts/qualification`, including the server version, Git SHA,
workload outcomes and recovery assertions. Retain the matching Actions
run URL and artifact before claiming any version compatibility.
This evidence does **not** qualify failover clusters, cloud routing,
customer SLAs, multi-day uptime, TLS on all versions, or non-Linux
architectures.

## Pinned cross-version TLS qualification

The version/restart workflow adds two independent verified-TLS CI jobs,
one each for official MySQL `8.0.44` and `8.4.11`, alongside the existing
plaintext and destructive-restart matrix. The TLS fixture accepts only those
exact image tags and defaults to `8.4.11` for the original driver job.
All connections are to a disposable TLS-required loopback server with an
ephemeral certificate authority. The version-specific regression suite
requires matching server identity, negotiated encryption, server version,
rejection of untrusted/missing CA, hostname mismatches, bad credentials
and attempted plaintext, plus native prepared, cursor and pool workflows.

Each CI matrix job also runs `qualify:mysql` under verified TLS, recording
bounded positive/negative authentication and session resource evidence in
a separate redacted artifact. These tests are not evidence of external TLS
load balancers, PKI revocation, cloud vendor authentication or production
support readiness. Run the GitHub Actions matrix on throwaway CI runners;
the fixture requires `RUNNER_TEMP` and `GITHUB_ENV` and never writes
certificates to the repository.

## Final matrix-wide release-evidence check

After the two native-version jobs and two TLS-version jobs finish, the
`mysql-qualification-evidence` job downloads their four independent
artifact groups and runs
`node tools/qualification/verify-matrix-evidence.mjs artifacts/matrix`.
The validator requires a complete and nonduplicated set of eight
same-revision reports (local benchmark, local soak, restart, TLS
benchmark for each supported test version). It rejects missing or
failed stages, mismatched server versions/transports/commits,
missing negative TLS authentication, unexpected errors, incomplete
timed soak duration, leaked pool connections and unsuccessful restart
invalidation. Scheduled runs are checked against a two-minute minimum;
PR and push checks require five seconds.

The emitted `artifacts/qualification-matrix/mysql-matrix-evidence-*.json`
is a concise, redacted per-version outcome, **not** a performance
certification or an automatic decision to release commercially.
Validator regressions run with:
`node --test tools/qualification/verify-matrix-evidence.test.mjs`.
The test fixtures use synthetic, entirely local JSON: no real MySQL
container, secrets or network access are needed. This final job fails
if either upstream matrix fails; CI evidence must be inspected before
making compatibility claims.

## Experimental in-process native component profiling

To identify which **component** merits profiling before changing production
code, run the optional internal profiler. It does **not** connect to MySQL
or use a third-party DBMS client and it adds **no tracing to the driver**:

```bash
npm run profile:mysql-internals -- --iterations=500 --rounds=6 --queueDepth=8
```

The profiler invokes actual built NuBloxSQL code against deterministic
in-memory fixtures, collecting per-round p50/p95/p99, work units per second,
and CPU/runtime context:

- `asyncHarness`: an intentionally minimal Promise/microtask timing baseline
- `packetFraming`: incremental parsing of one valid 256-byte Classic packet,
  exercising the native `PacketStream` and sequence reset
- `binaryRowDecode`: 128 synthetic three-column binary rows per timed sample,
  including a 64-bit integer, UTF-8 text, exact decimal and row-object mapping
- `serialPing`: one native `MysqlSession.healthCheckForPool` command,
  including native command serialization, packet send/receive and mocked OK
- `contendedPing`: the same native per-connection scheduler with 2–16
  competing commands, requiring strictly sequenced responses and no replay

A **sample** is one framing operation, one 128-row decode group, or one
single/concurrent ping group. Reported p50/p95/p99 are milliseconds **per
sample group**; `workUnits` and `workUnitsPerSecond` count the individual
rows/commands represented by each group. Dividing p50 of a concurrent group
by the queue depth is **not** a measurement of per-command latency.

Warmups (12 per stage/round) are excluded. Stage ordering rotates every
round to expose systematic thermal and JIT effects, and all fixtures are
validated and explicitly closed. The command queue uses a fake asynchronous
Classic OK response, not a real network socket. Consequently these are
**component-level microbenchmarks** including harness/Promise overhead.
They cannot be summed to estimate complete SQL-query latency, compared
directly with mysql2, or used alone to claim any driver optimisation.

Results are written to gitignored, private-permission
`artifacts/qualification/native-internal-profile-*.json` and collected in
a short correctness-focused CI smoke. There are no fixed performance
thresholds because shared CI hardware is noisy. For performance decisions
compare **multiple runs of the same stage** on dedicated, stable hardware
across commits, then use CPU profiling to attribute a specific code path.


## Decoder optimisation: before/after evidence

The native decoder hot path previously created temporary type-classification
arrays on every binary field and temporary collation arrays on every decoded
text cell. The targeted optimisation uses direct equality tests for the same
supported MySQL type IDs and collation IDs/ranges, retaining the exact
bitmaps, binary buffers, decimals, UTF-8/Latin-1 validation and failure modes.

The `Native MySQL decoder optimisation evidence` pull-request CI workflow
tests a candidate against the exact PR base revision in separate Git worktrees
on **one** Node 22 runner. Both receive identical synthetic fixtures from
`profile:mysql-internals`: 500 samples per stage, six rotated rounds, queue
depth eight. Runs alternate **base–candidate–candidate–base** to reveal some
CPU warmup, JIT and scheduling bias. Results and validated same-stage
median work-unit throughput ratios are retained as JSON artifacts alongside
the usual full regression suite.

To summarise the four raw results outside CI:

```bash
node tools/qualification/compare-internal-runs.mjs \
  artifacts/qualification/ab/baseline-1.json \
  artifacts/qualification/ab/candidate-1.json \
  artifacts/qualification/ab/candidate-2.json \
  artifacts/qualification/ab/baseline-2.json
```

`candidateToBaselineThroughputRatio > 1` indicates greater observed
throughput on the synthetic stage. The comparator rejects missing/duplicate
trials, incompatible options, differing Node/OS/architecture or mismatched
revisions. **No fixed speed threshold gates correctness**: numbers can vary
on hosted CI, and an apparent difference cannot establish production SQL
latency or a commercial speed claim. The same-stage decoder results are
reviewed separately from the command scheduler and packet-framing controls;
their timings must not be added together. Preserve and repeat profiles
under dedicated hardware before making sustained performance claims.


## Contiguous frame-header optimisation and measurement

The native MySQL Classic parser now decodes complete four-byte headers
directly from the received TCP Buffer instead of copying every header into a
scratch buffer. Headers split across data events continue to use the
incremental scratch path. All sequence, zero-length trailer, message-size and
queue bounds remain enforced.

A dedicated `Native MySQL frame-header optimisation evidence` PR workflow
builds the exact baseline and candidate in two separate Git worktrees. It
performs a **baseline–candidate–candidate–baseline** experiment in one
Node.js process on the same runner to compare those two compiled decoders.
Each timing sample synchronously parses a Buffer containing 256 complete
frames; every resulting packet is verified and drained **outside** the
measured interval. The experiment performs 20 untimed warmups, 500 timed
samples per round and six rounds per run. Its output reports the median
observed frames/sec per version and the candidate/baseline ratio.

Results are retained as `mysql-frame-header-ab-*.json`. These synthetic
measurements isolate the contiguous-header receive path, not the end-to-end
latency of a SQL statement, socket reads, TLS or real MySQL response processing.
Shared-runner jitter and V8 JIT/thermal effects persist even with alternating
order. There are **no performance pass/fail thresholds**. Repeat on stable
dedicated hardware before making product-level performance claims.

## Native session scheduler fast-path qualification

The MySQL session scheduler has an uncontended path: when its connection is
idle **and the pending FIFO is empty**, a command can begin immediately
without being appended and then shifted from the same JavaScript array.
Contending operations still use the existing bounded FIFO, and abort
listeners are installed and rechecked before starting either path.

The dedicated regression suite validates 256 consecutive native commands,
48 FIFO contenders interleaved with 12 cancelled requests, cancellation
during listener subscription, and closing a session with 64 queued commands.
Every accepted synthetic COM_PING is checked for exactly-once execution;
no cancelled or late command may write to a closed native connection.

The generalised `Native MySQL stage optimisation evidence` workflow uses
the exact PR base and candidate builds on one runner, executing the same
six-round profiler in base–candidate–candidate–base order. Inspect the
`serialPing` (uncontended) and `contendedPing` results in particular, plus
`packetFraming` and `binaryRowDecode` as negative controls. Published
throughput ratios are **descriptive synthetic stage measurements**, not
an SLA, full query latency, or a claim of universal DBMS performance.
Correctness gates merges; shared-CI timing does not impose arbitrary
percentage thresholds.

## Live MySQL workload profiling

For repeatable diagnostics using a **real isolated MySQL 8.4 server** rather
than the mocked internals profiler, use:

```bash
npm run profile:mysql-live -- --samples=30 --rows=500 --rowBytes=4096 --concurrency=4 --durationMs=3000
```

`profile:mysql-live` uses the same explicit fixture flags as the qualification
runner (`NUBLOX_LIVE_MYSQL=1` or `NUBLOX_LIVE_MYSQL_TLS=1`). It exercises:

- A persistent physical MySQL session and prepared statement, with eight
  unmeasured warmups, then bound parameter executions and p50/p95/p99 latency.
- Materialised ordered result sets of `--rows` (100–1000) rows, each
  containing a `--rowBytes` (256–8192) character payload. The workload
  validates every ordinal and payload and limits selected payloads to 8 MiB.
- Concurrent, bounded pooled SELECTs lasting at least `--durationMs`
  (500–120000). Each response is checked, there are no automatic retries,
  and exhausting `--maxOperations` (100–1000000) before the duration fails
  the evidence instead of mislabelling a short run as a soak.

`--samples` (3–1000) controls the prepared sample count; large-result
samples are `max(3,ceil(samples/3))`. `--concurrency` ranges from 1 to 16.
The command records per-workload latency percentiles, operation rate, sampled
process RSS/heap/external/array-buffer peaks and CPU time. Process memory deltas
are **not attributed allocations**; background GC and sampling intervals can
mask peaks. A profile is not evidence of production throughput or superiority
over another driver. Run repeated profiles under stable pinned conditions
before selecting a performance change. The PR driver CI runs a small
real-server profile and retains its report with existing qualification
artifacts; no arbitrary speed thresholds gate merges.

Only aggregated measurements, numeric validation counts, runtime details,
and redacted error codes are written. SQL, results and credentials do not
enter the JSON report. No additional published driver dependency is required.
