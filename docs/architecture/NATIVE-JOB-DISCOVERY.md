# Native Database Job Discovery

**Status: first public read-only foundation, October 2026.** This is not an
engine-native job management, scheduling or execution API.

`discoverNativeDatabaseJobs(client, { maxRows?, operation? })` and
`client.discoverNativeJobs(options?)` report the limited engine-native
scheduled-job inventory visible to the current connection.

- **MySQL:** reads `information_schema.EVENTS` and exposes only schema/name,
  status, one-time/recurring kind and time zone. It never reads `DEFINER`
  or `EVENT_DEFINITION`. It does not verify whether the Event Scheduler service
  is running, or report execution history.
- **SQL Server:** reads `msdb.dbo.sysjobs`, exposing only job GUID, name
  and enabled flag. It deliberately excludes owner SIDs, steps, subsystem
  commands, Agent service status, schedules, history and credentials. Access
  to `msdb` is privilege-dependent; authorization errors propagate.
- **PostgreSQL:** has no universal built-in native scheduler catalogue.
  Extension-backed systems such as `pg_cron`, and external schedulers, are
  explicitly *not inspected* by this foundation.
- **SQLite:** has no server-native scheduler. The report states
  `not-applicable` without running a query.

The response is deeply immutable, with a schema version, visibility and scope,
explicit limitations, a bounded `jobs` array, and a truncation indicator.
`complete` is always `false`: limited permissions, result limits and uninspected
external schedulers make a comprehensive inventory impossible.

The operation is read-only and uses static SQL with integer-validated limits.
It intentionally does not create, start, stop, reschedule or delete jobs.
It is a user-facing discovery foundation, independent of the internal durable
NuBloxSQL JobKernel. Later native adapters must establish identity, permission,
version and live-engine qualification before any mutation.

## Vendor references

- [MySQL INFORMATION_SCHEMA EVENTS](https://dev.mysql.com/doc/refman/8.4/en/information-schema-events-table.html)
- [SQL Server dbo.sysjobs](https://learn.microsoft.com/en-us/sql/relational-databases/system-tables/dbo-sysjobs-transact-sql)
- [PostgreSQL external maintenance scheduling](https://www.postgresql.org/docs/current/maintenance.html)

## Qualification

`node test/database-native-job-discovery.js` covers four dialect
contracts, bounded reads, permission failure, redaction and a real
in-memory SQLite public-Client call. Live MySQL event metadata and
SQL Server Agent inventory still require CI-backed engine evidence.
