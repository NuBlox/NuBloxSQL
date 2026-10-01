# SQLite Corruption and Hostile-Metadata Qualification

## Purpose

NuBloxSQL qualifies SQLite failure behaviour for malformed, corrupt and hostile database inputs so applications receive deterministic errors without crashes, misleading retry advice or metadata-quoting vulnerabilities.

This is a production-hardening gate rather than a performance benchmark. The qualification runs on every supported Node.js release in the SQLite CI matrix.

## Qualified scenarios

### Non-SQLite file presented as a database

The harness writes a deliberately invalid file and opens it through the normal SQLite connection surface. A schema access must fail deterministically and preserve a native SQLite `NOTADB`/corruption signal.

The normalized error contract must:

- identify the failure as a database/storage connection failure;
- retain the underlying SQLite corruption/not-database code;
- set `retryable` to `false` because retrying an immutable invalid database file cannot repair it.

### Physically truncated SQLite database

The harness creates a healthy multi-page database, verifies its integrity, closes it, truncates the file on disk and reopens it. Integrity or table access must then produce a deterministic corruption failure rather than a crash, hang or silent success.

### Hostile metadata and identifiers

A healthy database is created with legal but hostile identifiers containing:

- embedded double quotes;
- semicolons;
- SQL-looking text such as `DROP TABLE`;
- comment markers;
- Unicode characters;
- newlines and tabs.

`listTables()` and `tableInfo()` must round-trip these identifiers without executing identifier content as SQL. Data operations on the hostile table must still succeed when correctly quoted.

## Error classification policy

SQLite lock/contention failures such as `SQLITE_BUSY` and `SQLITE_LOCKED` remain retryable timeout-class failures.

Storage-format failures are different. `SQLITE_NOTADB`, `SQLITE_CORRUPT` and `SQLITE_FORMAT` are classified as connection/storage failures but are explicitly non-retryable. This prevents application retry loops from treating persistent file corruption like a transient network or locking problem.

## Evidence format

Successful qualification emits one machine-readable line:

```text
NUBLOX_SQLITE_PRODUCTION_CORRUPTION { ...json... }
```

The evidence contains the Node.js version and factual outcomes for the invalid-file, truncated-file and hostile-metadata scenarios.

## CI contract

The dedicated SQLite workflow executes the corruption suite across Node.js 22, 24 and 26. The suite is intentionally isolated from timing assumptions and must fail on any unexpected success, crash-equivalent exception shape, retryable corruption classification, lost native corruption signal or unsafe metadata round-trip.

## Scope boundary

This gate closes the current SQLite P0 malformed/corrupt schema and input-hardening requirement. Deeper P1 stress remains valuable for large backup/restore operations, session changeset conflict storms and broader fuzzed database-file mutation, but those are not required to close the current Tier-1 P0 baseline.
