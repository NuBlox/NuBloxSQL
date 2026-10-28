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

## Remaining commercial blockers

Release gates G4, G6 and G11 remain incomplete for production:
extended customer-representative write/transaction workloads, chaos
timing variation, multi-day memory/heap evidence, real network and
cloud failover, operational recovery targets, external security review
and sustained support arrangements are still required. Do not claim
an uptime SLA or commercial production readiness from this workflow.
