'use strict';

var MARIADB_REFS = Object.freeze({
  sequences: 'https://mariadb.com/docs/server/reference/sql-structure/sequences/create-sequence',
  sequenceOverview: 'https://mariadb.com/docs/server/reference/sql-structure/sequences/sequence-overview',
  release103: 'https://mariadb.com/docs/release-notes/community-server/old-releases/10.3/what-is-mariadb-103',
  systemVersioned: 'https://mariadb.com/docs/server/reference/sql-structure/temporal-tables/system-versioned-tables',
  release1034: 'https://mariadb.com/docs/release-notes/community-server/old-releases/release-notes-mariadb-10-3-series/mariadb-1034-release-notes',
  uuid: 'https://mariadb.com/docs/server/reference/data-types/string-data-types/uuid-data-type',
  json: 'https://mariadb.com/docs/server/reference/data-types/string-data-types/json',
  insertReturning: 'https://mariadb.com/docs/server/reference/sql-statements/data-manipulation/inserting-loading-data/insertreturning',
  delete: 'https://mariadb.com/docs/server/reference/sql-statements/data-manipulation/changing-deleting-data/delete',
  differences107: 'https://mariadb.com/docs/release-notes/community-server/about/compatibility-and-differences/incompatibilities-and-feature-differences-between-mariadb-and-mysql-unmaint/incompatibilities-and-feature-differences-between-mariadb-10-7-and-mysql-8'
});

module.exports = Object.freeze({
  schemaVersion: 1,
  overlays: Object.freeze({
    mariadb: Object.freeze({
      verification: 'documented',
      evidence: Object.freeze([
        MARIADB_REFS.sequences,
        MARIADB_REFS.systemVersioned,
        MARIADB_REFS.uuid,
        MARIADB_REFS.json,
        MARIADB_REFS.insertReturning,
        MARIADB_REFS.delete,
        MARIADB_REFS.differences107
      ]),
      changes: Object.freeze([
        Object.freeze({
          path: 'statements.createSequence',
          operation: 'override',
          support: 'native',
          evidence: 'documented',
          since: '10.3',
          nativeName: 'CREATE SEQUENCE',
          syntax: 'CREATE [OR REPLACE] [TEMPORARY] SEQUENCE',
          references: Object.freeze([MARIADB_REFS.sequences, MARIADB_REFS.release103]),
          notes: 'MariaDB implements sequence objects as a first-class alternative to AUTO_INCREMENT.'
        }),
        Object.freeze({
          path: 'schema.sequence',
          operation: 'override',
          support: 'native',
          evidence: 'documented',
          since: '10.3',
          nativeName: 'SEQUENCE',
          references: Object.freeze([MARIADB_REFS.sequenceOverview, MARIADB_REFS.release103])
        }),
        Object.freeze({
          path: 'schema.systemVersionedTable',
          operation: 'add',
          support: 'native',
          evidence: 'documented',
          since: '10.3.4',
          nativeName: 'WITH SYSTEM VERSIONING',
          syntax: 'CREATE TABLE ... WITH SYSTEM VERSIONING',
          references: Object.freeze([MARIADB_REFS.systemVersioned, MARIADB_REFS.release1034]),
          notes: 'MariaDB system-versioned tables implement historical row storage and FOR SYSTEM_TIME queries.'
        }),
        Object.freeze({
          path: 'queries.temporal.systemTime',
          operation: 'add',
          support: 'native',
          evidence: 'documented',
          since: '10.3.4',
          nativeName: 'FOR SYSTEM_TIME',
          syntax: 'FOR SYSTEM_TIME AS OF | BETWEEN | FROM ... TO | ALL',
          references: Object.freeze([MARIADB_REFS.systemVersioned, MARIADB_REFS.release1034])
        }),
        Object.freeze({
          path: 'types.uuid',
          operation: 'override',
          support: 'native',
          evidence: 'documented',
          since: '10.7',
          nativeName: 'UUID',
          references: Object.freeze([MARIADB_REFS.uuid]),
          notes: 'MariaDB provides a native 128-bit UUID data type from MariaDB 10.7.'
        }),
        Object.freeze({
          path: 'types.json',
          operation: 'override',
          support: 'equivalent',
          evidence: 'documented',
          nativeName: 'LONGTEXT COLLATE utf8mb4_bin',
          references: Object.freeze([MARIADB_REFS.json]),
          restrictions: Object.freeze([
            'MariaDB JSON is an alias for LONGTEXT rather than MySQL binary JSON storage.',
            'MySQL and MariaDB JSON comparison/storage semantics are not identical.'
          ]),
          notes: 'JSON compatibility is provided through a validated LONGTEXT alias, not MySQL native JSON binary storage.'
        }),
        Object.freeze({
          path: 'syntax.returning',
          operation: 'override',
          support: 'partial',
          evidence: 'documented',
          since: '10.5',
          nativeName: 'RETURNING',
          syntax: 'INSERT | REPLACE | DELETE ... RETURNING',
          references: Object.freeze([MARIADB_REFS.insertReturning, MARIADB_REFS.delete, MARIADB_REFS.differences107]),
          restrictions: Object.freeze([
            'RETURNING coverage is statement-specific; it is not a general DML RETURNING contract equivalent to PostgreSQL.',
            'Aggregate functions are not allowed in the documented INSERT/DELETE RETURNING result expressions.'
          ])
        }),
        Object.freeze({
          path: 'statements.insertReturning',
          operation: 'add',
          support: 'native',
          evidence: 'documented',
          since: '10.5',
          nativeName: 'INSERT ... RETURNING',
          references: Object.freeze([MARIADB_REFS.insertReturning, MARIADB_REFS.differences107])
        }),
        Object.freeze({
          path: 'statements.deleteReturning',
          operation: 'add',
          support: 'native',
          evidence: 'documented',
          nativeName: 'DELETE ... RETURNING',
          references: Object.freeze([MARIADB_REFS.delete, MARIADB_REFS.differences107]),
          restrictions: Object.freeze(['Single-table DELETE only.'])
        })
      ])
    })
  })
});
