# SQLite integrity diagnostics and maintenance

NuBloxSQL exposes structured SQLite maintenance operations through the native SQLite connection rather than requiring callers to construct maintenance PRAGMA strings manually.

## Integrity diagnostics

`connection.integrityCheck(options?)` wraps `PRAGMA integrity_check` and returns an immutable result containing `ok`, diagnostic messages, and native rows. `connection.quickCheck(options?)` provides the lower-cost `PRAGMA quick_check` equivalent. Both accept a database namespace and a positive `maxErrors` limit.

`connection.foreignKeyCheck(options?)` wraps `PRAGMA foreign_key_check`, optionally scoped to a table. Violations are normalized to table, rowid, parent table, and foreign-key id while retaining native evidence.

These checks report database health; they do not mutate application data.

## Planner maintenance

`connection.analyze({ database, target })` runs SQLite ANALYZE for a database or a validated table/index target. `connection.optimize({ database, mask })` exposes `PRAGMA optimize` with an optional non-negative bit mask and returns any native recommendation rows.

ANALYZE is explicit. NuBloxSQL does not silently schedule statistics collection because suitable cadence depends on workload and write volume.

## Space maintenance

`connection.vacuum({ database, into })` performs a full VACUUM. Supplying `into` creates a compacted database image at an explicit path using SQLite `VACUUM ... INTO` semantics.

`connection.incrementalVacuum(pages?, database?)` exposes `PRAGMA incremental_vacuum`. It is useful only when the database has been configured with incremental auto-vacuum. NuBloxSQL validates the page count but does not silently alter `auto_vacuum`, because changing that setting can require a full VACUUM and is a storage-policy decision.

## Attached databases

All diagnostic and maintenance operations accept an explicit database namespace where SQLite permits it. This works with databases attached through `connection.attach()` and uses the same strict identifier validation as the metadata and storage-policy APIs.

## Safety contract

- database and object identifiers are validated before SQL construction;
- integrity result objects are immutable;
- native SQLite execution still flows through the connection wrapper, preserving `SqliteError` normalization;
- destructive maintenance is never scheduled automatically;
- VACUUM, ANALYZE, optimize and incremental vacuum are explicit caller actions;
- maintenance tests run in the normal `npm run verify` and release qualification path on Node 22, 24 and 26.
