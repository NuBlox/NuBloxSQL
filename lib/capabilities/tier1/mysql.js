'use strict';

var model = require('../Model');
var f = model.feature;

module.exports = model.createModel('mysql', {
  family: 'mysql',
  name: 'MySQL',
  referenceVersion: '9.7',
  versionPolicy: 'server-evidence'
}, {
  statements: {
    select: f('native'), insert: f('native'), update: f('native'), delete: f('native'),
    merge: f('unsupported'), createTable: f('native'), alterTable: f('native'), dropTable: f('native'),
    grant: f('native'), revoke: f('native')
  },
  queries: {
    joins: {
      inner: f('native'), left: f('native'), right: f('native'), full: f('unsupported'), cross: f('native'),
      lateral: f('native', { since: '8.0.14', syntax: 'LATERAL' })
    },
    cte: {
      ordinary: f('native', { since: '8.0', syntax: 'WITH' }),
      recursive: f('native', { since: '8.0', syntax: 'WITH RECURSIVE' }),
      materializationHints: f('equivalent', { nativeName: 'optimizer hints', notes: 'MySQL controls CTE/derived-table optimization through optimizer behavior and hints rather than PostgreSQL-style MATERIALIZED syntax.' })
    },
    setOperators: { union: f('native'), intersect: f('native'), except: f('native') },
    grouping: { rollup: f('native'), cube: f('unsupported'), groupingSets: f('unsupported') },
    windows: { supported: f('native', { since: '8.0' }), named: f('native'), rows: f('native'), range: f('native'), groups: f('unsupported') }
  },
  schema: {
    table: f('native'), view: f('native'), materializedView: f('unsupported'), index: f('native'),
    sequence: f('unsupported'), schema: f('equivalent', { nativeName: 'database' }), database: f('native'),
    trigger: f('native'), domain: f('unsupported'), enum: f('native'), compositeType: f('unsupported')
  },
  expressions: {
    json: f('native', { nativeName: 'JSON' }), arrays: f('unsupported'), regex: f('native'),
    cast: f('native'), collations: f('native'), caseExpression: f('native')
  },
  integrity: {
    primaryKey: f('native'), foreignKey: f('native'), unique: f('native'), check: f('native'),
    exclusion: f('unsupported'), generatedColumns: f('native'), deferrableForeignKeys: f('unsupported'),
    identity: f('equivalent', { nativeName: 'AUTO_INCREMENT', syntax: 'AUTO_INCREMENT' })
  },
  physical: {
    partitioning: f('native'), tablespaces: f('native'), storageEngines: f('native'),
    clustering: f('partial', { notes: 'Physical clustering behavior is storage-engine specific rather than a portable CLUSTER command.' })
  },
  security: {
    usersAndRoles: f('native'), grants: f('native'), rowLevelSecurity: f('unsupported'),
    ownership: f('partial'), securityDefiner: f('native')
  },
  transactions: {
    transactions: f('native'), savepoints: f('native'), readOnly: f('native'), deferrable: f('unsupported'),
    advisoryLocks: f('equivalent', { nativeName: 'GET_LOCK/RELEASE_LOCK' }), skipLocked: f('native'), nowait: f('native')
  },
  programmability: {
    procedures: f('native'), functions: f('native'), anonymousBlocks: f('unsupported'),
    dynamicSql: f('native', { nativeName: 'PREPARE/EXECUTE' }), triggers: f('native')
  },
  administration: {
    explain: f('native'), explainAnalyze: f('native'), analyze: f('native', { nativeName: 'ANALYZE TABLE' }),
    vacuum: f('not-applicable'), sessionSettings: f('native'), queryHints: f('native')
  },
  dataMovement: {
    bulkLoad: f('native', { nativeName: 'LOAD DATA', syntax: 'LOAD DATA' }),
    bulkExport: f('native', { nativeName: 'SELECT ... INTO OUTFILE' }),
    federatedQueries: f('partial', { nativeName: 'FEDERATED', notes: 'Availability depends on server configuration and storage-engine support.' })
  },
  extensions: {
    pluginFramework: f('native'), storageEngines: f('native')
  },
  types: {
    json: f('native'), arrays: f('unsupported'), uuid: f('equivalent', { notes: 'UUID values are represented using character or binary types.' }),
    spatial: f('native')
  },
  functions: { userDefined: f('native'), tableFunctions: f('partial', { nativeName: 'JSON_TABLE' }), windowFunctions: f('native') },
  operators: { userDefined: f('unsupported'), jsonOperators: f('native'), regexOperators: f('native') },
  keywords: { catalogued: f('native') },
  syntax: { returning: f('unsupported'), conflictHandling: f('equivalent', { nativeName: 'ON DUPLICATE KEY UPDATE' }) },
  limits: { runtimeQueryable: f('partial', { notes: 'Many limits are exposed through server variables and implementation constraints.' }) }
});
