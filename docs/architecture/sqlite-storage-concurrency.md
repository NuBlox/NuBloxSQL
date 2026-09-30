# SQLite storage and concurrency policy

NuBloxSQL exposes SQLite storage policy explicitly rather than silently changing SQLite defaults.

## Connection policy

Connection options may select:

- `journalMode`: `delete`, `truncate`, `persist`, `memory`, `wal`, or `off`
- `synchronous`: `off`, `normal`, `full`, or `extra`
- `lockingMode`: `normal` or `exclusive`
- `busyTimeout`: non-negative milliseconds
- `walAutoCheckpoint`: non-negative WAL page threshold
- `cacheSize`: SQLite cache-size integer semantics

`productionDefaults: true` applies a documented production profile only where the caller has not supplied an explicit value:

- WAL journal mode
- NORMAL synchronous durability
- NORMAL locking
- 5000 ms busy timeout
- 1000-page WAL auto-checkpoint

The profile is intentionally opt-in because journal mode is persistent database state and applications may have deployment-specific durability or filesystem requirements.

## Inspection

`connection.storagePolicy()` returns the validated policy requested for the connection.

`connection.storageState(database?)` reads effective PRAGMA state and reports journal mode, synchronous level, locking mode, busy timeout, WAL auto-checkpoint threshold, cache size, page size, page count, and freelist count.

Callers should prefer effective state for diagnostics because SQLite can normalize or reject storage choices depending on database/runtime conditions.

## Checkpointing

`connection.checkpoint(mode?, database?)` supports `passive`, `full`, `restart`, and `truncate`, returning SQLite's busy, log-frame, and checkpointed-frame counts.

Explicit checkpoint control is useful for long-running WAL deployments, maintenance windows, and shutdown/backup orchestration. NuBloxSQL does not automatically issue aggressive checkpoints during normal query execution.

## Safety

All enum and integer options are validated before PRAGMA construction. Arbitrary PRAGMA tokens are not interpolated. Attached databases may be inspected by passing their validated namespace to `storageState()` or `checkpoint()`.
