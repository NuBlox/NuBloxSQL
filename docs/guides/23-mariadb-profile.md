# MariaDB profile over MySQL

NuBloxSQL models MariaDB as its own DBMS/dialect profile with the MySQL Tier-1 capability model used only as the nearest implemented baseline.

This is not an alias:

```text
MariaDB product/profile
        |
        +-- canonical dialect: mariadb
        +-- capability baseline: mysql
        +-- driver: not implemented
        +-- routable: false
        |
        +-- documented differences
```

The first official MariaDB overlay contains only differences supported by MariaDB documentation. These are **documented**, not live-qualified by a NuBloxSQL MariaDB runtime.

## Documented differences

### Sequence objects

MariaDB 10.3 added first-class sequence objects with `CREATE SEQUENCE`, `ALTER SEQUENCE`, `DROP SEQUENCE` and sequence value functions.

Official references:

- https://mariadb.com/docs/server/reference/sql-structure/sequences/create-sequence
- https://mariadb.com/docs/server/reference/sql-structure/sequences/sequence-overview
- https://mariadb.com/docs/release-notes/community-server/old-releases/10.3/what-is-mariadb-103

NuBloxSQL overlay paths:

```text
statements.createSequence
schema.sequence
```

Both resolve as `overlay-documented` from MariaDB 10.3 when the version context is supplied.

### System-versioned temporal tables

MariaDB 10.3.4 added system-versioned tables. The server supports `WITH SYSTEM VERSIONING` and `FOR SYSTEM_TIME` query semantics.

Official references:

- https://mariadb.com/docs/server/reference/sql-structure/temporal-tables/system-versioned-tables
- https://mariadb.com/docs/release-notes/community-server/old-releases/release-notes-mariadb-10-3-series/mariadb-1034-release-notes

NuBloxSQL overlay paths:

```text
schema.systemVersionedTable
queries.temporal.systemTime
```

### Native UUID type

MariaDB provides a native `UUID` data type from MariaDB 10.7.

Official reference:

- https://mariadb.com/docs/server/reference/data-types/string-data-types/uuid-data-type

This overrides the MySQL baseline, where NuBloxSQL currently models UUID storage as an application convention/equivalent rather than a native UUID type.

NuBloxSQL path:

```text
types.uuid
```

### JSON storage semantics

MariaDB's `JSON` type is an alias for `LONGTEXT COLLATE utf8mb4_bin`, introduced for MySQL compatibility. It is not MySQL's native binary JSON storage format, and the MariaDB documentation notes differences in storage and comparison semantics.

Official reference:

- https://mariadb.com/docs/server/reference/data-types/string-data-types/json

NuBloxSQL therefore overrides:

```text
types.json
```

from the MySQL baseline `native` classification to MariaDB `equivalent`, with the native name recorded as:

```text
LONGTEXT COLLATE utf8mb4_bin
```

### RETURNING

MariaDB documents statement-specific `RETURNING` support including `INSERT ... RETURNING`, `REPLACE ... RETURNING`, and single-table `DELETE ... RETURNING`. MariaDB documentation also identifies `INSERT ... RETURNING` and `REPLACE ... RETURNING` as available from MariaDB 10.5.

Official references:

- https://mariadb.com/docs/server/reference/sql-statements/data-manipulation/inserting-loading-data/insertreturning
- https://mariadb.com/docs/server/reference/sql-statements/data-manipulation/changing-deleting-data/delete
- https://mariadb.com/docs/release-notes/community-server/about/compatibility-and-differences/incompatibilities-and-feature-differences-between-mariadb-and-mysql-unmaint/incompatibilities-and-feature-differences-between-mariadb-10-7-and-mysql-8

NuBloxSQL records:

```text
syntax.returning          partial
statements.insertReturning native
statements.deleteReturning native
```

The general `syntax.returning` capability remains `partial` because MariaDB's support is statement-specific rather than a single PostgreSQL-style DML RETURNING contract.

## Version-aware resolution

Version-scoped differences are deliberately fail-closed.

```js
sql.profileCapabilities.status(
  'mariadb',
  'statements.createSequence'
);
// inherited-unverified because no MariaDB version was supplied

sql.profileCapabilities.status(
  'mariadb',
  'statements.createSequence',
  { context: { version: '10.2' } }
);
// inherited-unverified

sql.profileCapabilities.status(
  'mariadb',
  'statements.createSequence',
  { context: { version: '10.3' } }
);
// overlay-documented
// feature.support === 'native'
```

This prevents a feature introduced in one MariaDB release from being projected backwards onto every MariaDB version.

## What this does not claim

This overlay does not mean NuBloxSQL has a MariaDB driver.

The following remain unchanged:

```text
dialectRegistry.product('mariadb').driver.routable === false
createClient({ dialect: 'mariadb' }) -> unsupported
```

The overlay establishes documented SQL-semantic differences only.

## Promotion path

A future MariaDB runtime should progress through separate evidence stages:

1. documented profile overlay;
2. MySQL-wire compatibility assessment;
3. MariaDB-specific authentication/protocol qualification;
4. live supported-version matrix;
5. metadata and diagnostics qualification;
6. compiler/runtime behavior qualification against overlay paths;
7. only then promote `mariadb` to a routable adapter/profile.

This keeps NuBloxSQL's rule intact: compatibility is useful inheritance metadata, but actual support requires evidence.
