# NuBloxSQL Cookbook

The cookbook contains worked recipes for NuBloxSQL 1.1.x. The [user guides](../guides/README.md) explain the API and concepts; these recipes show how to combine those APIs into realistic application flows.

All examples use released public surfaces. A recipe marked **portable** uses the unified NuBloxSQL client. A recipe marked **native** intentionally uses a dialect runtime because the database exposes useful behaviour that should not be hidden behind a lowest-common-denominator abstraction.

## Recipes

1. [Portable CRUD service](01-portable-crud-service.md) — schema creation, create/read/update/delete, safe identifiers, results and cleanup.
2. [Joins, CTEs and reporting](02-joins-ctes-and-reporting.md) — relational joins, aggregation, CTEs, filtering and report pagination.
3. [Transactions, savepoints and retries](03-transactions-savepoints-retries.md) — atomic workflows, optional steps, nested work and transient retry policy.
4. [Streaming large result sets](04-streaming-large-results.md) — async iteration, early termination, timeouts, cancellation and result budgets.
5. [Build a schema browser](05-metadata-schema-browser.md) — native-rich metadata plus portable metadata v1.
6. [Diagnose query plans](06-query-diagnostics.md) — PostgreSQL, MySQL and SQLite EXPLAIN/diagnostic workflows.
7. [PostgreSQL service](07-postgresql-service.md) — pooling, transactions, COPY, notifications and diagnostics.
8. [MySQL service](08-mysql-service.md) — pooling, prepared work, secure LOCAL INFILE and structured diagnostics.
9. [SQLite production service](09-sqlite-production-service.md) — WAL policy, maintenance, backup, integrity and planner diagnostics.
10. [SQL Server service](10-sqlserver-service.md) — TDS pooling, parameterized execution, prepared work and transactions.
11. [Bulk data movement](11-bulk-data-movement.md) — engine-appropriate bulk ingestion patterns and portable fallbacks.
12. [Errors and observability](12-errors-and-observability.md) — error classification, native evidence, telemetry and operational logging.
13. [Capability analysis and migration](13-capability-and-migration.md) — compare dialects, plan rewrites and use the current SQL transpilation surface safely.

## Recipe rules

- Parameterize values. Do not concatenate untrusted values into SQL text.
- Use `sql.identifier()` for dynamic identifiers on the unified client.
- Close clients, pools, streams and prepared statements deterministically.
- Treat native features as dialect-specific contracts.
- Use the [support matrix](../SUPPORT.md) for the versions covered by the current release qualification claim.
- Use the [production guide](../guides/13-production-and-troubleshooting.md) before promoting an example to a real production service.

The cookbook is part of the released documentation set and is checked by `npm run release:check` for presence and valid relative links.
