'use strict';

var model = require('../Model');
var f = model.feature;

module.exports = model.createModel('sqlite', {
  family: 'sqlite',
  name: 'SQLite',
  referenceVersion: 'runtime',
  versionPolicy: 'runtime-probe'
}, {
  statements: {
    select: f('native'), insert: f('native'), update: f('native'), delete: f('native'),
    merge: f('unsupported'), createTable: f('native'), alterTable: f('partial'), dropTable: f('native'),
    grant: f('not-applicable'), revoke: f('not-applicable')
  },
  queries: {
    joins: {
      inner: f('native'), left: f('native'), right: f('runtime-dependent', { since: '3.39.0', evidence: 'runtime-version' }),
      full: f('runtime-dependent', { since: '3.39.0', evidence: 'runtime-version' }), cross: f('native'), lateral: f('unsupported')
    },
    cte: {
      ordinary: f('native', { syntax: 'WITH' }), recursive: f('native', { syntax: 'WITH RECURSIVE' }),
      materializationHints: f('runtime-dependent', { since: '3.35.0', syntax: 'MATERIALIZED | NOT MATERIALIZED', evidence: 'runtime-version' })
    },
    setOperators: { union: f('native'), intersect: f('native'), except: f('native') },
    grouping: { rollup: f('unsupported'), cube: f('unsupported'), groupingSets: f('unsupported') },
    windows: {
      supported: f('runtime-dependent', { since: '3.25.0', evidence: 'runtime-probe' }),
      named: f('runtime-dependent', { since: '3.25.0', evidence: 'runtime-probe' }),
      rows: f('runtime-dependent', { since: '3.25.0', evidence: 'runtime-probe' }),
      range: f('runtime-dependent', { since: '3.25.0', evidence: 'runtime-probe' }),
      groups: f('runtime-dependent', { since: '3.28.0', evidence: 'runtime-probe' })
    }
  },
  schema: {
    table: f('native'), view: f('native'), materializedView: f('unsupported'), index: f('native'),
    sequence: f('unsupported'), schema: f('equivalent', { nativeName: 'attached database namespace' }),
    database: f('native'), trigger: f('native'), domain: f('unsupported'), enum: f('unsupported'), compositeType: f('unsupported')
  },
  expressions: {
    json: f('runtime-dependent', { nativeName: 'JSON1/JSONB functions', evidence: 'runtime-probe' }),
    arrays: f('unsupported'), regex: f('unsupported', { notes: 'REGEXP requires an application-defined function.' }),
    cast: f('native'), collations: f('native'), caseExpression: f('native')
  },
  integrity: {
    primaryKey: f('native'), foreignKey: f('native'), unique: f('native'), check: f('native'), exclusion: f('unsupported'),
    generatedColumns: f('runtime-dependent', { since: '3.31.0', evidence: 'runtime-version' }),
    deferrableForeignKeys: f('native'), identity: f('equivalent', { nativeName: 'INTEGER PRIMARY KEY / ROWID' })
  },
  physical: {
    partitioning: f('unsupported'), tablespaces: f('not-applicable'), storageEngines: f('not-applicable'),
    clustering: f('unsupported')
  },
  security: {
    usersAndRoles: f('not-applicable'), grants: f('not-applicable'), rowLevelSecurity: f('unsupported'),
    ownership: f('not-applicable'), authorizer: f('runtime-dependent', { evidence: 'node-runtime-capability' }),
    defensiveMode: f('runtime-dependent', { evidence: 'node-runtime-capability' })
  },
  transactions: {
    transactions: f('native'), savepoints: f('native'), readOnly: f('partial', { notes: 'Connection/query-only and file open modes provide read-only behavior rather than a portable read-only transaction clause.' }),
    deferrable: f('partial', { notes: 'Foreign keys may be deferrable; transactions do not expose PostgreSQL-style DEFERRABLE semantics.' }),
    advisoryLocks: f('unsupported'), skipLocked: f('unsupported'), nowait: f('unsupported')
  },
  programmability: {
    procedures: f('unsupported'), functions: f('equivalent', { nativeName: 'application-defined functions' }),
    anonymousBlocks: f('unsupported'), dynamicSql: f('unsupported'), triggers: f('native')
  },
  administration: {
    explain: f('native'), explainAnalyze: f('unsupported'), analyze: f('native'), vacuum: f('native'),
    sessionSettings: f('equivalent', { nativeName: 'PRAGMA' }), queryHints: f('partial', { notes: 'SQLite exposes planner controls and clauses, not a general optimizer-hint syntax.' })
  },
  dataMovement: {
    bulkLoad: f('unsupported', { notes: 'The core SQL engine does not expose a COPY/LOAD DATA statement.' }),
    bulkExport: f('unsupported'), federatedQueries: f('unsupported')
  },
  extensions: {
    loadableExtensions: f('runtime-dependent', { evidence: 'node-runtime-capability' }),
    virtualTables: f('native')
  },
  types: {
    json: f('equivalent', { notes: 'JSON is represented using SQLite storage classes and JSON functions rather than a dedicated SQL type.' }),
    arrays: f('unsupported'), uuid: f('equivalent', { notes: 'UUID values are application conventions over TEXT or BLOB.' }),
    strictTables: f('runtime-dependent', { since: '3.37.0', evidence: 'runtime-probe' })
  },
  functions: { userDefined: f('equivalent', { nativeName: 'application-defined functions' }), tableFunctions: f('partial'), windowFunctions: f('runtime-dependent', { evidence: 'runtime-probe' }) },
  operators: { userDefined: f('unsupported'), jsonOperators: f('runtime-dependent', { evidence: 'runtime-probe' }) },
  keywords: { catalogued: f('native') },
  syntax: {
    returning: f('runtime-dependent', { since: '3.35.0', syntax: 'RETURNING', evidence: 'runtime-probe' }),
    conflictHandling: f('native', { nativeName: 'ON CONFLICT / UPSERT' })
  },
  limits: {
    runtimeQueryable: f('runtime-dependent', { evidence: 'node-runtime-capability' }),
    resourceGovernance: f('equivalent', { nativeName: 'NuBloxSQL resource governance' })
  }
});
