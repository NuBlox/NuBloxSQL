'use strict';

var model = require('../Model');
var f = model.feature;

module.exports = model.createModel('postgresql', {
  family: 'postgresql',
  name: 'PostgreSQL',
  referenceVersion: '18',
  versionPolicy: 'server-evidence'
}, {
  statements: {
    select: f('native'), insert: f('native'), update: f('native'), delete: f('native'),
    merge: f('native', { since: '15', syntax: 'MERGE' }),
    createTable: f('native'), alterTable: f('native'), dropTable: f('native'),
    grant: f('native'), revoke: f('native')
  },
  queries: {
    joins: {
      inner: f('native'), left: f('native'), right: f('native'), full: f('native'), cross: f('native'),
      lateral: f('native', { syntax: 'LATERAL' })
    },
    cte: {
      ordinary: f('native', { syntax: 'WITH' }),
      recursive: f('native', { syntax: 'WITH RECURSIVE' }),
      materializationHints: f('native', { since: '12', syntax: 'MATERIALIZED | NOT MATERIALIZED' })
    },
    setOperators: { union: f('native'), intersect: f('native'), except: f('native') },
    grouping: { rollup: f('native'), cube: f('native'), groupingSets: f('native') },
    windows: { supported: f('native'), named: f('native'), rows: f('native'), range: f('native'), groups: f('native') }
  },
  schema: {
    table: f('native'), view: f('native'), materializedView: f('native'), index: f('native'),
    sequence: f('native'), schema: f('native'), database: f('native'), trigger: f('native'),
    domain: f('native'), enum: f('native'), compositeType: f('native')
  },
  expressions: {
    json: f('native', { nativeName: 'json/jsonb' }), arrays: f('native'), regex: f('native'),
    cast: f('native'), collations: f('native'), caseExpression: f('native')
  },
  integrity: {
    primaryKey: f('native'), foreignKey: f('native'), unique: f('native'), check: f('native'),
    exclusion: f('native'), generatedColumns: f('native'),
    deferrableForeignKeys: f('native'), identity: f('native', { syntax: 'GENERATED ... AS IDENTITY' })
  },
  physical: {
    partitioning: f('native'), tablespaces: f('native'), tableAccessMethods: f('native'),
    clustering: f('native', { syntax: 'CLUSTER' })
  },
  security: {
    usersAndRoles: f('native', { nativeName: 'roles' }), grants: f('native'), rowLevelSecurity: f('native'),
    ownership: f('native'), securityDefiner: f('native')
  },
  transactions: {
    transactions: f('native'), savepoints: f('native'), readOnly: f('native'), deferrable: f('native'),
    advisoryLocks: f('native'), skipLocked: f('native'), nowait: f('native')
  },
  programmability: {
    procedures: f('native'), functions: f('native'), anonymousBlocks: f('native', { syntax: 'DO' }),
    dynamicSql: f('native'), triggers: f('native')
  },
  administration: {
    explain: f('native'), explainAnalyze: f('native'), analyze: f('native'), vacuum: f('native'),
    sessionSettings: f('native')
  },
  dataMovement: {
    bulkLoad: f('native', { nativeName: 'COPY', syntax: 'COPY' }),
    bulkExport: f('native', { nativeName: 'COPY', syntax: 'COPY' }),
    foreignTables: f('native')
  },
  extensions: {
    extensionFramework: f('native', { syntax: 'CREATE EXTENSION' }), listenNotify: f('native')
  },
  types: {
    json: f('native'), arrays: f('native'), ranges: f('native'), uuid: f('native'), network: f('native')
  },
  functions: { userDefined: f('native'), tableFunctions: f('native'), windowFunctions: f('native') },
  operators: { userDefined: f('native'), jsonOperators: f('native'), arrayOperators: f('native') },
  keywords: { catalogued: f('native') },
  syntax: { returning: f('native', { syntax: 'RETURNING' }), conflictHandling: f('native', { syntax: 'ON CONFLICT' }) },
  limits: { runtimeQueryable: f('partial', { notes: 'Limits are a mixture of implementation and configuration constraints.' }) }
});
