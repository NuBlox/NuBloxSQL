# NuBloxSQL — Repeated outage and endurance evidence

**Status: engineering qualification only — not production availability or commercial release certification.**

## Why this is separate

The pinned [current-release matrix](../.github/workflows/mysql-current-support.yml)
already verifies functional MySQL 8.4.13/9.7.4/26.10 compatibility, TLS
on the LTS versions, and one real database server restart per version.
The separate [resilience workflow](../.github/workflows/mysql-resilience.yml)
adds repeated failures, bounded pool-queue pressure, and a much longer
uninterrupted read-only workload. It does not replace the current-release
matrix or any legacy regression suite.

## Real destructive outage qualification

Only a disposable GitHub Actions MySQL **8.4.13** container is targeted.
The runner requires `CI=true`, `NUBLOX_LIVE_MYSQL=1`, an exact image
version, a matching container ID, an exact commit SHA and the explicit
`NUBLOX_ALLOW_DESTRUCTIVE_MYSQL_FIXTURE=1` opt-in. The underlying
single-crash harness independently validates the Docker image before
every destructive action. Never use these scripts against production,
shared development, or customer databases.

For every cycle:

1. Start a bounded MySQL pool (maximum two physical connections) and
   launch twelve simultaneous checkout requests. Hold two borrowers
   until at least one other borrower is queued; prove the pool never
   exceeds its cap and every SQL request completes once.
2. Send a prepared SQL request, kill `mysqld` while that request is
   in flight, and verify connection and prepared-handle revocation,
   no application SQL replay, and a fresh authenticated pool session
   after restart.
3. Repeat the twelve-borrower pressure phase after recovery. Require
   zero native pool slots and zero waiters after both phases, and take
   observed RSS/heap resource snapshots.

The PR/main job requires **two complete crash cycles** and four pressure
phases. Scheduled/manual jobs require **six cycles** and twelve pressure
phases. The runner retains the original restart report from each crash,
plus an overall redacted summary. A separate dependent
`mysql-repeated-outage-evidence` job checks the same commit and exact
server version, all numbered crash reports, pool-capacity invariants,
original recovery assertions, and that there is no stale, duplicated or
missing evidence. Failed or skipped upstream tests fail the decision.

Memory snapshots show process observations, not evidence of zero
allocations or a statistically sound absence of leaks. Pool disposal
and bounded pending checkouts are enforced invariants. Tests do not
automatically replay SQL or silently retry an ambiguous write.

## Real ambiguous-COMMIT reconciliation

The dedicated `mysql-transaction-reconciliation` CI job uses a disposable
MySQL **8.4.13** database, an InnoDB table unique to each test, application
idempotency tokens and independent, freshly authenticated reconciliation
reads. Two complementary deterministic fault cases must both pass:

- **Durable transaction, acknowledgement lost:** a loopback fault proxy
  forwards the original COMMIT to MySQL, then corrupts its otherwise
  successful acknowledgement. The native Driver returns
  `TRANSACTION_OUTCOME_UNKNOWN`; the pooled session is discarded. A
  fresh connection confirms exactly one durable row with the token.
- **COMMIT never transmitted:** a test-only hook drops the native socket
  before COMMIT can reach the wire. The Driver still returns
  `TRANSACTION_OUTCOME_UNKNOWN` because its caller cannot assert the
  durable result. MySQL rolls back the open InnoDB transaction; a fresh
  connection confirms that the token is absent.

Both cases verify that the application transaction callback and bound
INSERT are executed exactly once, no COMMIT or application SQL is replayed,
the failed native socket cannot re-enter the pool, a new authenticated
session works, all waiters drain, and no physical pool capacity remains
after closure. Test-created tables are dropped in `finally` blocks. The
two cases demonstrate **why a transport error alone is insufficient to
determine the committed business outcome**: the application must reconcile
its own stable business/idempotency key.

The underlying tests are also part of the full driver regression suite.
They do **not** perform a real `mysqld` crash during an ambiguous
COMMIT, validate replica durability, customer transaction isolation,
external side effects or a multi-node failover. Write-path resilience and
G4/G11 therefore remain **partial/not met** for a commercial release.

## Server-enforced durable fencing epochs and restricted writers

The `mysql-durable-fencing-epoch` job starts an isolated **MySQL 8.4.13
TLS-required** server with a temporary, hostname-verified CA. It creates
two separate, fixture-only authenticated database principals, each
restricted to **EXECUTE** on a test-owned `SQL SECURITY DEFINER` stored
routine. Neither principal can read the authority table or insert
directly into the operation table.

The stored routine starts a MySQL transaction, reads the active
`(epoch, holder)` authority row **FOR UPDATE**, compares the requested
epoch and `USER()` authenticated account identity, and then inserts the
unique business operation token inside that **same transaction**.
Wrong holders, stale/future epochs and replayed tokens are rejected
by MySQL, not by an in-memory client flag. A trusted administrative
compare-and-swap advances the epoch monotonically; concurrent
advances from the same expected epoch must yield exactly one winner.
Already-connected former holders must fail immediately after the
authority row changes. The test then **restarts the real pinned MySQL
server** and requires the durable epoch to survive, with the
former epoch still denied and the current authorised holder admitted.

A separate job checks a redacted, original same-run report and
negative fixtures for stale epochs, impersonation, privilege
escalation, competing CAS winners, lost state after restart,
operation replay and incomplete cleanup.

**Limits:** this is a **single-MySQL authority row** managed by a
trusted administrator. The native NuBloxSQL Driver does not yet
route all application writes through this routine. An administrator
or privileged direct SQL client can bypass this test's account
restrictions. This is **not** an external consensus authority,
automated distributed leader election, crash-proof multisite
fencing, network partition quorum or full production admission
control. G11 remains **not met**.

## Asymmetric client views and externally enforced source fencing

The `mysql-asymmetric-fencing` job creates two individually
isolated **observer** Docker networks in addition to the pinned
MySQL 8.4.13 replication fixture. Each observer authenticates to
only its own reachable MySQL endpoint and cannot access the other
endpoint's observer-network address. The observer paths intentionally
disagree about which database is reachable. Neither a successful
connection nor a locally healthy database authorises promotion.

After GTID catch-up is established, the test disconnects the private
replication network, commits one additional business token on the
original primary, and verifies that the stale read-only replica lacks
the token and the source GTID barrier times out. The replica must
reject client writes and the promotion decision must be blocked.

The source is then **write-fenced** with
`SET PERSIST super_read_only=ON` and a real client INSERT must
be rejected. CI sends a genuine Docker `SIGKILL` to that source
and confirms the process has stopped. Even after the hard kill,
promotion remains blocked because the candidate still lacks GTIDs.
On restarting the original source, the persisted write fence must
remain in effect and another client write must be rejected.
The replication network is reconnected and the replica must catch up
to the original committed GTID set. Both servers must remain
read-only after this particular recovery test; there is no
automatic promotion, write replay or second writable primary.

A separate same-run evidence job rejects unverified observer views,
missing hard kill, an unsafe restart, incomplete GTID catch-up
or unremoved test infrastructure. All tests operate exclusively on
disposable, independently labelled Docker fixtures.

**Scope:** observer reachability asymmetry and one replication-link
partition on a single Docker host, with an explicitly controlled
process kill and persisted SQL write fence. This is not a distributed
consensus protocol, an external fencing authority suitable for
production, a quorum election, network packet-level fault matrix,
or general split-brain prevention. Commercial G11 remains unmet.

## Live GTID network partition and split-brain refusal

The pinned `mysql-gtid-network-partition` CI profile exercises two real
MySQL 8.4.13 instances with separate host-access networking and a
dedicated GTID replication bridge. It verifies unique server identities,
GTID auto-positioning, source-to-replica catch-up and a read-only standby,
then disconnects **only the private replication network**. Both nodes
remain reachable to the test client; health alone cannot authorise
promotion.

One bound transaction is acknowledged on the original writable source
after isolation. The replica must be missing that committed business
token, and `WAIT_FOR_EXECUTED_GTID_SET` must time out against the
source's executed GTIDs. The replica must reject a direct client write.
With the original source still active and unfenced and the replica
behind, the explicit safety decision **blocks promotion**, new replica
writes and application SQL replay.

The job reconnects the replication network without changing the primary
role, restarts only the replication receiver, verifies that both threads
resume, waits for GTID application, and confirms that both business
tokens are present while the replica remains read-only and the original
source remains the sole writer. Disposable Docker resources are removed.
A separate evidence job validates exact-run, exact-revision observations;
negative fixtures reject forged catch-up, dual writers, missing
partition isolation, unauthorised promotion and incomplete cleanup.

This tests a controlled **replication-link partition**, not all
network partition topologies, production quorum/election, external
fencing or arbitrary split-brain recovery. It is **not** an automatic
HA router or general guarantee of loss-free failover. G11 remains open.

## Former-primary restart and read-only GTID rejoin

The `mysql-gtid-former-primary-rejoin` CI profile extends the existing
GTID replication/fenced-promotion experiment. Before killing the old source,
it applies `SET PERSIST super_read_only=ON`, verifies its runtime
`super_read_only` and `read_only` state, and then fences the process.
After a caught-up replica is explicitly promoted and accepts a new business
token, the original source is **restarted without dropping its persistent
fence**.

The runner requires the recovered instance to start healthy but with both
read-only flags still enabled. It submits an actual bound INSERT as the
administrative test user and requires a database-level rejection and no
durable row. It configures GTID `SOURCE_AUTO_POSITION=1` in the reverse
direction, verifies both replication threads, and waits for the promoted
source's full executed GTID set. Only after the wait succeeds does it
verify the original and promoted business tokens on the old instance,
which must remain `super_read_only=ON`. The promoted instance must
remain writable. Both disposable containers and their isolated network
are then removed.

An independent evidence gate requires the same Git revision and run,
both original GTID/fenced-promotion prerequisites, persisted write fencing,
a rejected former-primary client write, live reverse replication, exact
GTID catch-up, both tokens, one writable primary and complete disposal.
Negative tests reject writable restarts, skipped write rejection,
missing GTID catch-up and duplicate application writes.

This is **controlled CI former-primary rejoin qualification**, not a
general-purpose source election, commercial automatic failover or a
production re-seeding system. Incorrectly configured customer nodes
can still become split-brain without external fencing authority,
topology ownership and explicit operator approvals. G11 remains open.

## GTID replication and test-only source-fenced promotion

A separate CI-only `mysql-gtid-fenced-promotion` profile provisions **two
disposable MySQL 8.4.13 containers** with distinct server IDs and UUIDs,
GTID mode, row-based binary logging and an isolated Docker network.
It creates a dedicated replication user, enables
`CHANGE REPLICATION SOURCE TO ... SOURCE_AUTO_POSITION=1`, starts
the replica, and verifies both replication threads and read-only
standby settings.

The profile commits a bound business-operation token on the source,
captures its complete executed GTID set, requires the replica's
`WAIT_FOR_EXECUTED_GTID_SET(..., 20)` to report successful
application, and independently checks that the token is present on
the read-only replica. **Only then** does the test SIGKILL and
verify fencing of the old source and apply a separate explicitly
approved *fixture-only* promotion decision. It stops and clears the
replication channel, enables writes on the previously read-only
replica and proves a new token can be committed while the original
token remains present. The former source must stay stopped.
The containers and private Docker network are removed rather than
restarting a now-divergent former primary.

The test rejects a lagged replica, a missing GTID application barrier,
an unfenced old primary, missing explicit test approval, duplicate
business writes and either server accepting unapproved promotion.
A dependent evidence job rechecks the exact run, commit, server
identity, caught-up GTIDs, fence, acknowledged writes, no replay
and isolated resource disposal before retaining a reduced report.

This is **a genuine replication and controlled promotion experiment**,
but not a production HA implementation: the Driver still exposes
endpoint-bound pools and does not provide topology discovery, fencing
authority, automatic promotion, cross-region consensus, RPO/RTO
guarantees or restoration/rejoining of the old primary. Only a
disposable CI fixture can authorise this promotion. G11 is still open.

References: MySQL 8.4 manual, GTID replication setup, SOURCE_AUTO_POSITION
and WAIT_FOR_EXECUTED_GTID_SET.

## Two-node cutover safety: an independent standby is not an HA replica

The `mysql-two-node-cutover` job uses **two separate, disposable MySQL
8.4.13 containers**, on independent loopback ports 3306 and 3307. Both
container identities, server versions and internal server UUIDs must differ
appropriately before a test-owned committed InnoDB operation token is
established on the original primary. The second instance is intentionally
**not configured for replication**.

The runner kills the actual primary process during a dispatched read,
proves that the old native pooled session fails and is discarded, and
establishes a fresh authenticated connection to the separate standby.
Despite its passing health check, the standby **does not possess** the
committed business token. The explicit cutover policy therefore refuses
promotion or resumed writes and forbids automatic replay. After the
original container recovers, the primary must still hold exactly one
durable token. Test-owned tables and pool slots must be cleaned up.

The separate `mysql-two-node-cutover-evidence` job independently
verifies the exact-run report, the two distinct pinned MySQL endpoints,
the real crash, original write count, absent standby data, blocked
cutover, zero replay, restored original primary and resource cleanup.
Pure negative tests reject forged promotions, replay, wrong versions,
missing crashes and incomplete cleanup.

**This is a fail-closed topology boundary test, not replication,
automatic promotion, a high-availability implementation or a valid
customer failover claim.** A real HA milestone requires verified
replication consistency, authoritative topology election/fencing,
safe promotion and recovery-point evidence under both network
partitions and leader crashes. G11 remains open.

## Real MySQL server crash during an unacknowledged COMMIT

The `mysql-commit-server-crash` CI job now uses an isolated, pinned
MySQL **8.4.13** Docker service and a test-owned InnoDB table. It binds
a unique application token in one INSERT, then pauses delivery of the
COMMIT acknowledgement. Only after the native COMMIT frame has been
written once does the runner execute a genuine `docker kill --signal=KILL`
against the verified disposable service. The buffered acknowledgement
is never permitted to confirm success to the native driver.

The driver must return `TRANSACTION_OUTCOME_UNKNOWN`, discard the
poisoned native socket, and avoid replaying the transaction callback,
INSERT or COMMIT. After the same MySQL container is restarted and
healthy, a **new authenticated connection** reads the token: a count
of **0 or 1** is valid, since actual crash timing can determine whether
the server made the COMMIT durable. The driver must never guess the
business outcome. A replacement pool connection must work; native
pool slots and waiters must reach zero on cleanup. The CI runner
restores the service even after a test failure and drops the owned
table when the fixture is available.

A separate `mysql-commit-server-crash-evidence` job downloads the
original same-run JSON report, independently verifies the exact
commit/run, pinned MySQL version, real crash, single submission,
unknown outcome, authoritative read, fresh pool recovery and cleanup,
and retains a reduced decision artifact. Synthetic negative fixtures
reject forged or incomplete evidence in normal `npm test`.

This is a **real single-node server-crash test** at the COMMIT boundary,
not deterministic control over the instant InnoDB writes its commit
record. It does not prove distributed exactly-once semantics,
replica durability, crash recovery point objectives, cloud failover or
safe automatic resubmission of absent tokens. G4/G11 remain open.

## Mixed API lifecycle qualification

A new pinned MySQL **8.4.13** job exercises four time-bounded
**concurrent pooled phases** against a disposable, isolated server:
ordinary bound reads, create/execute/close prepared statements,
two-row server-side cursors with one-row fetch batches, and read-only
transactions including deliberately triggered rollbacks followed by a
same-lease recovery query. Each phase requires successful concurrent
operations and a recorded memory snapshot at its boundaries.

The PR and `main` push jobs run an **eight-second functional smoke**.
Scheduled and manually dispatched resilience workflows extend this
mixed profile to **ten minutes**. These are separate from the existing
30-minute/two-hour standard read-soak; no long-run success is assumed
until an actual corresponding job passes and its artifact is retained.

The runner records exact completed operation counts, bounded
1024-value latency reservoirs for each phase, phase-level heap/RSS/
external/ArrayBuffer snapshots, and a bounded whole-run memory timeline.
It recomputes the trend with the existing conservative investigation
guardrails, requires full configured elapsed duration, and proves
zero pooled sessions and waiters after shutdown. Any incorrect value,
uncaught rollback, prematurely exhausted operation cap or failed cleanup
fails the job. Original SQL, credentials, row values and connection IDs
are not written into the report.

The corresponding isolated synthetic regression tests use fake sessions,
including injected statement failures, wrong rows, swallowed rollbacks
and deliberate pool leaks. This qualifies **API coexistence across
time-sequenced phases**, not a proof of memory-leak freedom, heavy
concurrent writes, replica failover or customer representative workload
stability. G4/G6/G11 therefore remain open.

## Timed endurance

The optional separate `mysql-extended-soak` job uses the existing
read-only, parameter-bound, pooled workload with periodic **expected**
SQL errors. It is run on the weekly schedule for at least **30 minutes**
and via manual Actions dispatch for **one or two hours**. A run hitting
the iteration safety ceiling before its duration fails; successful
runs require the full elapsed duration, zero unexpected errors, a
bounded pool, and zero native pool capacity after close.

The manual two-hour setting enables collection of long-duration
evidence; it does **not** mean that a two-hour run has completed.
Only an actual successful workflow and retained report count as
qualification. These workloads are on Ubuntu / Node.js 22 against
one isolated MySQL 8.4.13 container, not a cloud HA, replica failover,
multi-architecture or customer deployment profile.

Reports are saved as versioned JSON Actions artifacts. They contain
no database credentials, SQL text, query results or connection IDs.
Retain the commit, GitHub run URL, exact version, measured duration,
completed operations, expected/unexpected error counts, resource
statistics and cleanup status.

## Bounded sustained-memory and latency observation

The timed pooled-soak runner no longer retains every query's latency in an
unbounded array. Its **4,096-sample deterministic reservoir** uses constant
storage even when millions of operations execute; `count`, `completed` and
throughput still reflect **all** completed operations. P50/P95/P99 are now
sample-based estimates for soaks (not exact full-population percentiles);
`percentileMethod`, `latencySamples` and `latencySampleCapacity` disclose
the method and coverage. Short benchmarks retain exact latency percentiles.

The same runner records pooled workload process-memory observations every
**30 seconds**, plus the start and finish, for a maximum of **256 samples**:
heap used, resident set size, external memory and ArrayBuffers. The
timeline is bounded and saved in the existing redacted soak JSON report.
A pure post-run validator recomputes the difference between median readings
in the first and final fifths of the trace, verifies sample integrity and
minimum duration coverage, and rejects retained-growth signals above
**128 MiB heap used** or **256 MiB RSS**. These are conservative
**investigation guardrails**, not product memory SLAs or statistical proof
of a memory leak. V8 garbage collection, heap reservation and operating
system caching may legitimately affect the trajectory.

A long-soak report without enough observations, with malformed readings
or with a forged trend now fails the independent evidence gate. The
ordinary unit suite includes synthetic plateau, continuous-growth,
out-of-order, oversized and tampered-trace regressions. A multi-hour
observed plateau is evidence of *bounded observed growth* in that
specific process and workload, **not** proof of leak freedom or
customer-representative reliability.

## Independent extended-soak evidence decision

A scheduled or manually dispatched `mysql-extended-soak` run must also
pass the separate `mysql-extended-soak-evidence` job before its endurance
result counts as qualified engineering evidence. That job does **not** run
a second long database test: it downloads the original bounded JSON artifact
and checks its identity, content and cleanup independently.

The validator requires the exact originating Git commit and Actions run,
the pinned MySQL 8.4.13 isolated-local Linux x64 / Node 22 profile, a
complete `soak` result and the selected configuration (30 minutes on the
weekly schedule, or precisely one/two hours via manual dispatch). It rejects
an iteration-limited early exit, missing expected SQL errors, any unexpected
error, absent reconnect work, incomplete operations, nonzero pool slots/
waiters at close, and missing process memory/duration observations. Only one
run-matching JSON report is accepted; stale/duplicate reports fail closed.
The resulting separate `mysql-extended-soak-decision-<run-id>` artifact
contains no SQL, passwords, result rows or connection identifiers.

`node --test tools/qualification/extended-soak-evidence.test.mjs` runs
in normal CI and checks deliberately corrupted synthetic report fixtures
without requiring a real database or a multi-hour run. The independent
decision itself runs only when a real scheduled/manual long-soak job
finishes. PR/push checks cannot claim those durations have already passed.

Passing verifies measured duration and cleanup invariants, **not**
memory-leak freedom, a statistically robust memory-growth trend,
customer workload endurance, an uptime SLA or commercial approval.

## Remaining commercial blockers

Release gates G4, G6 and G11 remain incomplete for production:
extended customer-representative write/transaction workloads, chaos
timing variation, multi-day memory/heap evidence, real network and
cloud failover, operational recovery targets, external security review
and sustained support arrangements are still required. Do not claim
an uptime SLA or commercial production readiness from this workflow.
