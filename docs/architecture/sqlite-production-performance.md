# SQLite Production Performance Qualification

## Purpose

NuBloxSQL qualifies SQLite production performance with repeatable, correctness-checked workloads rather than publishing hardware-specific headline benchmarks. The goal is to detect catastrophic regressions and retain machine-readable evidence across the supported Node.js matrix.

The qualification uses a temporary file-backed database in WAL mode and runs on Node.js 22, 24 and 26.

## Workloads

The harness covers:

- repeated unprepared reads;
- repeated prepared reads;
- autocommit prepared writes;
- bulk prepared writes inside an explicit transaction;
- large-result materialization through `query()`;
- incremental row consumption through `PreparedStatement.iterate()`;
- repeated table and column metadata introspection;
- storage-state verification for the file-backed WAL database.

Each workload verifies result correctness as well as execution time.

## Evidence format

A successful qualification emits one machine-readable line:

```text
NUBLOX_SQLITE_PRODUCTION_PERFORMANCE { ...json... }
```

The document includes Node.js and SQLite versions, workload counts, elapsed times, operations per second, qualification ceilings and storage state.

## Threshold policy

The CI thresholds are deliberately generous. They are release-safety ceilings, not claims about absolute SQLite performance and not comparisons against other drivers or machines.

Current maximum wall-clock ceilings are:

| Workload | Ceiling |
| --- | ---: |
| 1,000 unprepared reads | 10 s |
| 5,000 prepared reads | 10 s |
| 250 autocommit writes | 15 s |
| 5,000 transactional writes | 10 s |
| large-result materialization | 10 s |
| iterator consumption | 10 s |
| 500 metadata operations | 10 s |

A workload exceeding its ceiling fails qualification. This catches severe performance regressions while avoiding brittle dependence on shared-runner speed.

## Scope boundary

This slice qualifies runtime performance only. It does not close SQLite's separate P0 requirements for retained-memory evidence, WAL/contention stress or malformed/corrupt schema and input hardening.
