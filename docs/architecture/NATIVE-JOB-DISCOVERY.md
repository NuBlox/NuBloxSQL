# Native Database Job Discovery and Operational Visibility

**Status: public read-only foundation with opt-in operational metadata, October 2026.**
This is not an engine-native job management, scheduling or execution API.

The two supported entry points are:

- \`discoverNativeDatabaseJobs(client, { maxRows?, includeOperational?, operation? })\`
- \`client.discoverNativeJobs({ maxRows?, includeOperational?, operation? })\`

By default \`includeOperational\` is \`false\`: the original bounded, lightweight
inventory contract is preserved. Opting in performs a richer read for engines
whose native metadata exposes scheduling and execution evidence.

\`\`\`js
const report = await db.discoverNativeJobs({
  maxRows: 100,
  includeOperational: true
});
for (const job of report.jobs) {
  console.log(job.name, job.operational);
}
\`\`\`

## Engine-specific operational metadata

**MySQL Event Scheduler** — the query reads \`information_schema.EVENTS\`.
Inventory entries report schema, name, status, recurrence kind and event time
zone. With \`includeOperational: true\`, an optional \`operational\` field also
contains:

- \`lastExecutedLocal\`: the time the event last **started**, or \`null\`;
- \`schedule.executeAtLocal\`, \`startsLocal\`, \`endsLocal\`;
- \`schedule.intervalValue\` and \`intervalField\`;
- \`outcome: 'not-reported'\` because EVENTS cannot establish the result of
  an execution. **Do not infer success from LAST_EXECUTED.**

MySQL date/time values are strings in event-local context; there is no
implied UTC offset. No \`DEFINER\`, \`EVENT_DEFINITION\`, SQL body or user name is
selected or persisted. Engine, replication and account privileges limit
visibility and may make the inventory incomplete. The scheduler service
running state is not checked.

**SQL Server Agent** — default inventory reads \`msdb.dbo.sysjobs\` only.
Opt-in operational discovery additionally performs read-only correlated
lookups against \`msdb.dbo.sysjobhistory\` and \`msdb.dbo.sysjobschedules\`.
For each visible job it returns:

- \`operational.scheduleCount\`;
- \`nextRunLocal\` (or \`null\`) with \`nextRunMayBeStale: true\`;
- \`lastRun\` (or \`null\`) with \`outcome\`, \`startedLocal\`, and
  \`durationSeconds\`, including durations longer than 24 hours;
- \`runningStateReliable: false\` — job-level history does **not** guarantee
  that an in-progress job will be represented.

Only the **latest job-outcome history row** (where \`step_id = 0\`) is
inspected. No step commands, owner SIDs, job messages, SQL bodies or
credentials are read. Agent histories may be incomplete due to retention and
authorization; the opt-in query may require extra \`msdb\` permissions. Access
errors are propagated, not silently converted to an empty inventory.

\`msdb.dbo.sysjobschedules\` is refreshed approximately every 20 minutes,
so reported next-run data may lag. Returned times are local calendar values
without a UTC offset. The report never claims a live Agent execution state.

**PostgreSQL** — the core server has no universal Agent/Event Scheduler
catalogue. Extensions (e.g. \`pg_cron\`) and external schedulers remain
\`not-inspected\` pending separate adapter qualification. Neither mode
issues scheduling SQL.

**SQLite** — there is no server-native scheduler; visibility is
\`not-applicable\` and no scheduling SQL is executed.

## Safety and qualification

The response remains schema version 1, deeply immutable, permission-scoped,
bounded to \`maxRows\` (1–1000, fetching one additional row to identify
truncation). \`complete\` is always \`false\`. Operational details appear only
when explicitly opted in and are omitted entirely otherwise.

All SQL is fixed-text with integer-validated limits. Date/time, status,
duration and schedule values are validated, not blindly copied from database
rows. The API does not create, start, stop, reschedule or delete native jobs.
It remains independent of the internal NuBloxSQL durable JobKernel.

## Qualification

\`node test/database-native-job-discovery.js\` covers inventory compatibility,
both opt-in dialect contracts, bounded reads, schedule metadata, last-run
outcomes, long durations, malformed dates, permission errors, redaction and
a real in-memory SQLite public-client call.

**Live MySQL Event Scheduler and SQL Server Agent opt-in queries remain
unqualified against vendor instances.** CI contract tests alone do not
establish live compatibility or production operational monitoring.

## Vendor references

- [MySQL INFORMATION_SCHEMA EVENTS](https://dev.mysql.com/doc/refman/8.4/en/information-schema-events-table.html)
- [SQL Server Agent sysjobs](https://learn.microsoft.com/en-us/sql/relational-databases/system-tables/dbo-sysjobs-transact-sql)
- [SQL Server Agent sysjobhistory](https://learn.microsoft.com/en-us/sql/relational-databases/system-tables/dbo-sysjobhistory-transact-sql)
- [SQL Server Agent sysjobschedules](https://learn.microsoft.com/en-us/sql/relational-databases/system-tables/dbo-sysjobschedules-transact-sql)
