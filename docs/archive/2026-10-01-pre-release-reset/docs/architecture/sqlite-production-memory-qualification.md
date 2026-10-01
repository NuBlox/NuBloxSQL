# SQLite Production Memory Qualification

## Purpose

NuBloxSQL qualifies SQLite memory behaviour with repeatable, correctness-checked workloads and explicit regression ceilings. The goal is to detect severe retained-memory or materialization regressions across supported Node.js versions without presenting shared-runner memory measurements as hardware-independent product claims.

The qualification runs on Node.js 22, 24 and 26 with `--expose-gc` so retained JavaScript memory can be measured after explicit garbage collection.

## Workloads

The harness uses a temporary file-backed SQLite database in WAL mode and covers two production-oriented memory scenarios:

1. **Large-result materialization**
   - creates 20,000 rows with payloads of at least 512 bytes per row;
   - materializes the complete result through `query()`;
   - records peak process memory while the result is live;
   - releases the result, forces garbage collection and records retained memory.
2. **Long-lived connection use**
   - retains the same open connection;
   - performs 25,000 prepared point reads;
   - repeatedly exercises table and column metadata introspection;
   - forces garbage collection and records retained growth relative to a clean baseline.

Every scenario also verifies query correctness and confirms that the backing database remains in WAL mode.

## Evidence format

A successful qualification emits one machine-readable line:

```text
NUBLOX_SQLITE_PRODUCTION_MEMORY { ...json... }
```

The document contains:

- Node.js and SQLite versions;
- fixture dimensions;
- workload counts;
- configured ceilings;
- RSS, heap total, heap used, external and ArrayBuffer snapshots;
- peak and retained deltas;
- file-backed storage state.

## Ceiling policy

The current ceilings are deliberately generous release-safety thresholds:

| Scenario | Metric | Ceiling |
| --- | --- | ---: |
| Large-result materialization | peak heap growth | 256 MiB |
| Large-result materialization | peak RSS growth | 384 MiB |
| Large-result materialization after GC | retained heap growth | 64 MiB |
| Large-result materialization after GC | retained RSS growth | 256 MiB |
| Long-lived connection after GC | retained heap growth | 64 MiB |
| Long-lived connection after GC | retained RSS growth | 256 MiB |

Negative deltas are treated as zero for threshold comparison because allocator and garbage-collector behaviour can make a post-scenario snapshot smaller than its baseline.

These limits are not promises about normal application memory consumption. They are designed to fail on catastrophic regressions while remaining robust across GitHub-hosted runners and supported Node.js releases.

## Qualification contract

The memory harness requires explicit garbage collection. Running the file directly without `--expose-gc` fails immediately and intentionally. The repository script supplies the required runtime flag:

```bash
npm run test:sqlite-production
```

That command runs both production performance evidence and production memory evidence.

## Scope boundary

This slice closes SQLite's current P0 memory-evidence requirement. Separate P0 work remains for WAL/rollback-journal contention and malformed/corrupt schema or input hardening. Backup and session-changeset stress remain subsequent depth work.
