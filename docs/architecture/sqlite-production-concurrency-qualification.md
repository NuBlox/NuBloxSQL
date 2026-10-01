# SQLite Production Concurrency Qualification

## Purpose

NuBloxSQL qualifies SQLite concurrency behaviour with deterministic, file-backed contention scenarios rather than synthetic single-connection checks. The production qualification covers both WAL and rollback-journal operation and verifies that lock contention, reader/writer interaction, checkpoint recovery and post-contention forward progress remain predictable across supported Node.js versions.

## WAL qualification

The WAL scenario opens two NuBloxSQL connections to the same file-backed database and verifies:

- both connections retain WAL mode;
- an active `BEGIN IMMEDIATE` writer can coexist with a reader that sees only committed state;
- a competing writer fails with a bounded, retryable timeout classification while the first writer holds the write lock;
- once the first writer commits, the competing writer can make progress;
- a read transaction retains a stable snapshot across a concurrent writer commit;
- checkpoint activity remains observable while a reader holds an older snapshot;
- a truncate checkpoint completes after the reader releases its snapshot;
- alternating writers repeatedly acquire and release write ownership without starvation after lock release.

## Rollback-journal qualification

The rollback-journal scenario verifies:

- both connections retain `DELETE` journal mode;
- an active `BEGIN IMMEDIATE` writer excludes a competing writer while ordinary committed reads remain available;
- competing writes fail as bounded, retryable timeout errors;
- an established read transaction can block a writer's commit;
- after the reader releases its shared lock, the same writer transaction can complete successfully;
- alternating writers repeatedly acquire the database write lock and make forward progress.

## Busy-timeout policy

The production stress harness uses a deliberately short `150 ms` busy timeout so lock-contention tests remain deterministic and bounded in CI. Qualification requires lock failures to be surfaced through NuBloxSQL as:

- `category: "timeout"`;
- `retryable: true`.

The test does not require a precise elapsed duration because host scheduling and SQLite's internal busy handling differ slightly between supported Node.js releases. It does require each contention operation to remain bounded.

## Evidence format

A successful run emits one machine-readable line:

```text
NUBLOX_SQLITE_PRODUCTION_CONCURRENCY { ...json... }
```

The evidence includes:

- Node.js version;
- configured busy timeout;
- alternating-writer fairness rounds;
- measured contention durations;
- normalized timeout/retryable classification;
- checkpoint state;
- final writer-progress counts for WAL and rollback-journal scenarios.

## Qualification command

The concurrency stress suite is part of the existing SQLite production gate:

```bash
npm run test:sqlite-production
```

That command now runs production performance, memory and concurrency qualification together.

## Scope boundary

This slice targets lock/contention semantics and recovery. It does not replace SQLite's malformed/corrupt schema and hostile-input qualification, which remains a separate P0 production-hardening requirement.
