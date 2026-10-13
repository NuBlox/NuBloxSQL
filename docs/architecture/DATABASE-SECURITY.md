# Database Security Administration — Read-Only Discovery Foundation

**Status (13 October 2026):** Public read-only discovery implemented. Privileged
administration, access change planning, policy/effective privilege calculation,
audit exports and live multi-engine qualification remain **not delivered**.

NuBloxSQL owns database-specific administration semantics, not identity-provider
provisioning, corporate HR/job profiles or policy decisions on behalf of an
application. This work implements the first inspect/understand step in
`administration.security`, informed by the database profession register's
activities `a12`, `a13` and `a22`.

## API

```js
const { createClient, discoverDatabaseSecurity } = require('nubloxsql');

const db = createClient({ dialect: 'postgresql', /* connection options */ });
try {
  const report = await db.discoverSecurity({ maxRows: 500 });
  // Equivalent: await discoverDatabaseSecurity(db, { maxRows: 500 })
  console.log(report.scope, report.visibility, report.summary);
} finally {
  await db.close();
}
```

This is a **read-only, best-effort native-catalogue observation**, not a test
that the connected user may perform a requested administrative operation.
The report includes `complete: false` **for all engines**, and
`summary.truncated.{principals,memberships,grants}` records whether output
was limited. Default `maxRows` is 1000; bounds are 1–1000 per category.
Existing NuBloxSQL operation-control options are passed through as
`{ operation: { /* controls */ } }`. Inventory errors propagate; callers
must not treat a failed read as an empty privilege list.

The report has a fixed schema version, dialect, honest scope and visibility
labels, frozen `principals`, `memberships`, `grants`, and counts. No
password hashes, secrets, credential material or unrestricted
`native`-row dumps are deliberately selected or retained.

## Native engine boundaries

| Engine | Inspection | Actual scope/visibility | What is *not* established |
| --- | --- | --- | --- |
| PostgreSQL | `pg_catalog.pg_roles` (selected nonsecret role attributes) and `pg_catalog.pg_auth_members` | Cluster-visible roles and memberships; privileges/visibility of the caller apply | Object privileges, computed inheritance/effective access, password hashes, auth policy |
| MySQL | `CURRENT_USER()` and `SHOW GRANTS FOR CURRENT_USER()` | Current authenticated account only; native GRANT/REVOKE text retained as **statements**, not parsed entitlements | Other accounts, activated roles/effective permission closure, complete grants |
| SQL Server | `sys.database_principals`, `sys.database_role_members`, `sys.database_permissions` | Current database, metadata visible to caller; explicit permission states including DENY/REVOKE | Server logins, fixed database role implicit permissions, server-scope permissions, effective privileges |
| SQLite | No SQL queries executed | `not-applicable` to server-managed SQL principals/grants | Application authorization and OS file permissions live outside the SQLite database role model |

**There is no invented cross-engine SQL `GRANT`/`REVOKE` writer.** SQL
Server's `DENY` is kept distinct from `REVOKE`. MySQL grant text is
deliberately not parsed into a supposed universal set. PostgreSQL
`rolcanlogin` remains a native role attribute, not an SQL Server login.
SQLite's empty arrays must not be interpreted as permission-free database
access.

## Engineering/qualification boundaries

The contract tests include SQL-shape and secret-column assertions, 4-dialect
read-only normalization, actual in-memory SQLite Client invocation,
independent grants versus memberships, permission-limited report labels,
input validation, result truncation, immutability and failure propagation.
**Live server integration testing for PostgreSQL, MySQL and SQL Server remains
outstanding.** Operator-privileged inventory completeness is also not
demonstrated: visibility follows the native connected principal.

The **next security-administration increment** should add explicit,
engine-honest `SecurityChangePlan` intents (create/drop role/principal,
membership, grant/revoke/deny), immutable target binding, DCL capability
gates, drift preconditions and manual/approval boundaries. Do not perform
any mutation until a qualified executor, privilege authorizer, target-side
reconciliation and native live tests are in place.

### Vendor references

- [PostgreSQL pg_roles](https://www.postgresql.org/docs/current/view-pg-roles.html) and [pg_auth_members](https://www.postgresql.org/docs/current/catalog-pg-auth-members.html).
- [MySQL SHOW GRANTS](https://dev.mysql.com/doc/refman/8.4/en/show-grants.html).
- [SQL Server database principals](https://learn.microsoft.com/en-us/sql/relational-databases/system-catalog-views/sys-database-principals-transact-sql),
  [role members](https://learn.microsoft.com/en-us/sql/relational-databases/system-catalog-views/sys-database-role-members-transact-sql)
  and [permissions](https://learn.microsoft.com/en-us/sql/relational-databases/system-catalog-views/sys-database-permissions-transact-sql).
- [SQLite authorization callback](https://www.sqlite.org/c3ref/set_authorizer.html) (application-level, not SQL role management).
