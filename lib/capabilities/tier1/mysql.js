'use strict';

var model = require('../Model');
var f = model.feature;

var R = Object.freeze({
  select: 'https://dev.mysql.com/doc/refman/9.7/en/select.html',
  insert: 'https://dev.mysql.com/doc/refman/9.7/en/insert.html',
  update: 'https://dev.mysql.com/doc/refman/9.7/en/update.html',
  delete: 'https://dev.mysql.com/doc/refman/9.7/en/delete.html',
  createTable: 'https://dev.mysql.com/doc/refman/9.7/en/create-table.html',
  generated: 'https://dev.mysql.com/doc/refman/9.7/en/create-table-generated-columns.html',
  createIndex: 'https://dev.mysql.com/doc/refman/9.7/en/create-index.html',
  with: 'https://dev.mysql.com/doc/refman/9.7/en/with.html',
  lateral: 'https://dev.mysql.com/doc/refman/9.7/en/lateral-derived-tables.html',
  setOperations: 'https://dev.mysql.com/doc/refman/9.7/en/set-operations.html',
  windows: 'https://dev.mysql.com/doc/refman/9.7/en/window-functions.html',
  json: 'https://dev.mysql.com/doc/refman/9.7/en/json.html',
  types: 'https://dev.mysql.com/doc/refman/9.7/en/data-types.html',
  constraints: 'https://dev.mysql.com/doc/refman/9.7/en/create-table-foreign-keys.html',
  partitioning: 'https://dev.mysql.com/doc/refman/9.7/en/partitioning.html',
  partitionLimits: 'https://dev.mysql.com/doc/refman/9.7/en/partitioning-limitations-storage-engines.html',
  storageEngines: 'https://dev.mysql.com/doc/refman/9.7/en/storage-engines.html',
  roles: 'https://dev.mysql.com/doc/refman/9.7/en/roles.html',
  privileges: 'https://dev.mysql.com/doc/refman/9.7/en/privileges-provided.html',
  innodbTransactions: 'https://dev.mysql.com/doc/refman/9.7/en/innodb-transaction-model.html',
  isolation: 'https://dev.mysql.com/doc/refman/9.7/en/innodb-transaction-isolation-levels.html',
  lockingReads: 'https://dev.mysql.com/doc/refman/9.7/en/innodb-locking-reads.html',
  xa: 'https://dev.mysql.com/doc/refman/9.7/en/xa.html',
  routines: 'https://dev.mysql.com/doc/refman/9.7/en/stored-routines.html',
  compound: 'https://dev.mysql.com/doc/refman/9.7/en/sql-compound-statements.html',
  restrictions: 'https://dev.mysql.com/doc/refman/9.7/en/stored-program-restrictions.html',
  triggers: 'https://dev.mysql.com/doc/refman/9.7/en/triggers.html',
  events: 'https://dev.mysql.com/doc/refman/9.7/en/event-scheduler.html',
  explain: 'https://dev.mysql.com/doc/refman/9.7/en/explain.html',
  analyze: 'https://dev.mysql.com/doc/refman/9.7/en/analyze-table.html',
  optimize: 'https://dev.mysql.com/doc/refman/9.7/en/optimize-table.html',
  performanceSchema: 'https://dev.mysql.com/doc/refman/9.7/en/performance-schema.html',
  optimizerHints: 'https://dev.mysql.com/doc/refman/9.7/en/optimizer-hints.html',
  systemVariables: 'https://dev.mysql.com/doc/refman/9.7/en/server-system-variables.html',
  loadData: 'https://dev.mysql.com/doc/refman/9.7/en/load-data.html',
  outfile: 'https://dev.mysql.com/doc/refman/9.7/en/select-into.html',
  plugins: 'https://dev.mysql.com/doc/refman/9.7/en/plugin-api.html',
  replication: 'https://dev.mysql.com/doc/refman/9.7/en/replication.html'
});

function my(support, reference, options) {
  options = Object.assign({}, options || {});
  options.references = (options.references || []).slice();
  if (reference && R[reference]) options.references.unshift(R[reference]);
  return f(support, options);
}

module.exports = model.createModel('mysql', {
  family: 'mysql',
  name: 'MySQL',
  referenceVersion: '9.7',
  versionPolicy: 'server-evidence'
}, {
  statements: {
    select: my('native', 'select'), insert: my('native', 'insert'), update: my('native', 'update'), delete: my('native', 'delete'),
    replace: my('native', 'insert', { syntax: 'REPLACE', standard: 'MySQL extension' }), merge: my('unsupported', 'insert'),
    values: my('native', 'select'), table: my('native', 'select'),
    createTable: my('native', 'createTable'), createTableAs: my('native', 'createTable'), alterTable: my('native', 'createTable'),
    dropTable: my('native', 'createTable'), truncate: my('native', 'createTable'), renameTable: my('native', 'createTable'),
    createView: my('native', 'createTable'), createIndex: my('native', 'createIndex'), createDatabase: my('native', 'createTable'),
    createSchema: my('equivalent', 'createTable', { nativeName: 'CREATE DATABASE' }), createSequence: my('unsupported', 'createTable'),
    createProcedure: my('native', 'routines'), createFunction: my('native', 'routines'), createTrigger: my('native', 'triggers'),
    createEvent: my('native', 'events'), grant: my('native', 'privileges'), revoke: my('native', 'privileges'),
    createUser: my('native', 'roles'), createRole: my('native', 'roles'), setRole: my('native', 'roles'),
    startTransaction: my('native', 'innodbTransactions'), commit: my('native', 'innodbTransactions'), rollback: my('native', 'innodbTransactions'),
    savepoint: my('native', 'innodbTransactions'), releaseSavepoint: my('native', 'innodbTransactions'),
    xa: my('native', 'xa', { nativeName: 'XA transactions' }),
    loadData: my('native', 'loadData'), explain: my('native', 'explain'), analyzeTable: my('native', 'analyze'),
    optimizeTable: my('native', 'optimize'), checkTable: my('native', 'optimize'), repairTable: my('partial', 'optimize', { restrictions: ['Storage-engine dependent'] }),
    set: my('native', 'systemVariables'), show: my('native', 'systemVariables'), use: my('native', 'createTable')
  },

  queries: {
    joins: {
      inner: my('native', 'select'), left: my('native', 'select'), right: my('native', 'select'), full: my('unsupported', 'select'),
      cross: my('native', 'select'), natural: my('native', 'select'),
      lateral: my('native', 'lateral', { since: '8.0.14', syntax: 'LATERAL' }), straightJoin: my('native', 'select', { standard: 'MySQL extension' })
    },
    subqueries: {
      scalar: my('native', 'select'), correlated: my('native', 'select'), exists: my('native', 'select'), in: my('native', 'select'),
      anyAll: my('native', 'select'), derivedTables: my('native', 'select')
    },
    cte: {
      ordinary: my('native', 'with', { since: '8.0', syntax: 'WITH' }), recursive: my('native', 'with', { since: '8.0', syntax: 'WITH RECURSIVE' }),
      dataModifying: my('partial', 'with', { notes: 'CTEs can precede supported DML statements, but MySQL does not implement PostgreSQL-style data-modifying statements inside the WITH list.' }),
      materializationHints: my('equivalent', 'with', { nativeName: 'optimizer hints', notes: 'Optimizer merging/materialization is controlled through optimizer behavior and hints.' }),
      search: my('unsupported', 'with'), cycle: my('unsupported', 'with')
    },
    setOperators: {
      union: my('native', 'setOperations'), unionAll: my('native', 'setOperations'), intersect: my('native', 'setOperations'),
      intersectAll: my('native', 'setOperations'), except: my('native', 'setOperations'), exceptAll: my('native', 'setOperations')
    },
    grouping: {
      groupBy: my('native', 'select'), having: my('native', 'select'), rollup: my('native', 'select', { nativeName: 'WITH ROLLUP' }),
      cube: my('unsupported', 'select'), groupingSets: my('unsupported', 'select')
    },
    windows: {
      supported: my('native', 'windows', { since: '8.0' }), named: my('native', 'windows'), rows: my('native', 'windows'),
      range: my('native', 'windows'), groups: my('unsupported', 'windows'), exclude: my('partial', 'windows', { notes: 'EXCLUDE syntax support is limited relative to PostgreSQL/SQL standard coverage.' })
    },
    distinct: { standard: my('native', 'select'), on: my('unsupported', 'select') },
    ordering: { orderBy: my('native', 'select'), nullsFirstLast: my('unsupported', 'select', { notes: 'NULL ordering is expressed through ordering expressions rather than NULLS FIRST/LAST syntax.' }) },
    pagination: { limit: my('native', 'select'), offset: my('native', 'select'), fetch: my('unsupported', 'select') },
    locking: {
      forUpdate: my('native', 'select'), forShare: my('native', 'select'), nowait: my('native', 'select'), skipLocked: my('native', 'select'),
      ofTable: my('native', 'select')
    },
    tableSampling: { system: my('unsupported', 'select'), bernoulli: my('unsupported', 'select') },
    tableFunctions: { jsonTable: my('native', 'json', { nativeName: 'JSON_TABLE' }), generalUserDefined: my('unsupported', 'routines') }
  },

  schema: {
    table: my('native', 'createTable'), temporaryTable: my('native', 'createTable'), view: my('native', 'createTable'), materializedView: my('unsupported', 'createTable'),
    index: my('native', 'createIndex'), uniqueIndex: my('native', 'createIndex'), descendingIndex: my('native', 'createIndex'),
    functionalIndex: my('native', 'createIndex', { nativeName: 'functional key parts' }), multiValuedIndex: my('native', 'createIndex'),
    fullTextIndex: my('native', 'createIndex'), spatialIndex: my('native', 'createIndex'), invisibleIndex: my('native', 'createIndex'),
    sequence: my('unsupported', 'createTable'), schema: my('equivalent', 'createTable', { nativeName: 'database' }), database: my('native', 'createTable'),
    procedure: my('native', 'routines'), function: my('native', 'routines'), trigger: my('native', 'triggers'), event: my('native', 'events'),
    enum: my('native', 'types'), setType: my('native', 'types'), domain: my('unsupported', 'types'), compositeType: my('unsupported', 'types'), rangeType: my('unsupported', 'types'),
    tablespace: my('native', 'storageEngines'), resourceGroup: my('native', 'systemVariables')
  },

  expressions: {
    arithmetic: my('native', 'select'), comparison: my('native', 'select'), boolean: my('native', 'select'), threeValuedLogic: my('native', 'select'),
    caseExpression: my('native', 'select'), ifFunction: my('native', 'select', { standard: 'MySQL extension' }), ifNull: my('native', 'select'), nullif: my('native', 'select'),
    cast: my('native', 'types'), collations: my('native', 'types'), rowConstructors: my('native', 'select'),
    json: my('native', 'json'), jsonPath: my('native', 'json'), jsonTable: my('native', 'json'), jsonValue: my('native', 'json'),
    arrays: my('unsupported', 'types', { notes: 'MySQL has no general SQL array type; JSON arrays are supported inside JSON values.' }),
    regex: my('native', 'select'), like: my('native', 'select'), dateTime: my('native', 'types'), intervals: my('native', 'types'),
    aggregateWindowing: my('native', 'windows'), aggregateFilter: my('unsupported', 'windows', { notes: 'Use conditional aggregation rather than SQL FILTER (WHERE ...) syntax.' }),
    namedFunctionArguments: my('unsupported', 'routines')
  },

  integrity: {
    notNull: my('native', 'createTable'), check: my('native', 'createTable'), unique: my('native', 'createTable'), primaryKey: my('native', 'createTable'),
    foreignKey: my('native', 'constraints'), exclusion: my('unsupported', 'constraints'),
    deferrableUnique: my('unsupported', 'constraints'), deferrablePrimaryKey: my('unsupported', 'constraints'), deferrableForeignKeys: my('unsupported', 'constraints'),
    onDeleteCascade: my('native', 'constraints'), onDeleteSetNull: my('native', 'constraints'), onDeleteRestrict: my('native', 'constraints'), onDeleteNoAction: my('native', 'constraints'),
    onUpdateCascade: my('native', 'constraints'), onUpdateSetNull: my('native', 'constraints'), onUpdateRestrict: my('native', 'constraints'), onUpdateNoAction: my('native', 'constraints'),
    generatedColumns: my('native', 'generated'), generatedVirtual: my('native', 'generated'), generatedStored: my('native', 'generated'),
    identity: my('equivalent', 'createTable', { nativeName: 'AUTO_INCREMENT', syntax: 'AUTO_INCREMENT' }),
    autoIncrement: my('native', 'createTable'), checkEnforcementControl: my('native', 'createTable', { syntax: 'ENFORCED | NOT ENFORCED' })
  },

  physical: {
    partitioning: my('native', 'partitioning', { restrictions: ['Native partitioning is storage-engine dependent.'] }),
    partitionRange: my('native', 'partitioning'), partitionList: my('native', 'partitioning'), partitionHash: my('native', 'partitioning'), partitionKey: my('native', 'partitioning'),
    subpartitioning: my('native', 'partitioning'), partitionSelection: my('native', 'partitioning'),
    partitionedInnoDbForeignKeys: my('unsupported', 'partitionLimits', { notes: 'Partitioned InnoDB tables cannot participate in foreign-key relationships.' }),
    storageEngines: my('native', 'storageEngines'), innodb: my('native', 'storageEngines'), myisam: my('native', 'storageEngines'), memory: my('native', 'storageEngines'), archive: my('native', 'storageEngines'),
    tablespaces: my('native', 'storageEngines'), rowFormats: my('native', 'storageEngines'), compression: my('native', 'storageEngines'),
    clustering: my('partial', 'storageEngines', { notes: 'InnoDB clusters rows by primary key; MySQL has no general CLUSTER command.' }),
    invisibleIndexes: my('native', 'createIndex'), descendingIndexes: my('native', 'createIndex'), functionalIndexes: my('native', 'createIndex'), multiValuedIndexes: my('native', 'createIndex'),
    nativeColumnstore: my('unsupported', 'storageEngines'), coreTransparentSharding: my('unsupported', 'storageEngines', { notes: 'NDB Cluster is a distinct distributed deployment/storage engine rather than transparent sharding of InnoDB.' })
  },

  security: {
    usersAndRoles: my('native', 'roles'), accounts: my('native', 'roles'), roles: my('native', 'roles'), roleMembership: my('native', 'roles'), defaultRoles: my('native', 'roles'),
    grants: my('native', 'privileges'), revokes: my('native', 'privileges'), columnPrivileges: my('native', 'privileges'), dynamicPrivileges: my('native', 'privileges'),
    ownership: my('partial', 'privileges', { notes: 'MySQL privilege semantics are grant-based and do not expose PostgreSQL-style object ownership uniformly.' }),
    rowLevelSecurity: my('unsupported', 'privileges'), securityDefiner: my('native', 'routines'), securityInvoker: my('native', 'routines'),
    proxyUsers: my('native', 'privileges'), accountTlsRequirements: my('native', 'roles'), authenticationPlugins: my('native', 'plugins'),
    dynamicDataMaskingCore: my('unsupported', 'privileges', { notes: 'Masking functionality is not a general core SQL row/column policy equivalent to RLS.' })
  },

  transactions: {
    transactions: my('native', 'innodbTransactions'), mvcc: my('native', 'innodbTransactions'),
    readUncommitted: my('native', 'isolation'), readCommitted: my('native', 'isolation'), repeatableRead: my('native', 'isolation'), serializable: my('native', 'isolation'),
    defaultRepeatableRead: my('native', 'isolation'), readOnly: my('native', 'innodbTransactions'), readWrite: my('native', 'innodbTransactions'),
    savepoints: my('native', 'innodbTransactions'), nestedTransactions: my('emulated', 'innodbTransactions', { nativeName: 'savepoints' }), deferrable: my('unsupported', 'isolation'),
    rowLocks: my('native', 'lockingReads'), tableLocks: my('native', 'lockingReads'), advisoryLocks: my('equivalent', 'lockingReads', { nativeName: 'GET_LOCK/RELEASE_LOCK' }),
    nowait: my('native', 'select'), skipLocked: my('native', 'select'), xaTransactions: my('native', 'xa'), autonomousTransactions: my('unsupported', 'innodbTransactions')
  },

  programmability: {
    procedures: my('native', 'routines'), functions: my('native', 'routines'), storedPrograms: my('native', 'routines'),
    compoundStatements: my('native', 'compound'), localVariables: my('native', 'compound'), assignment: my('native', 'compound'),
    conditionals: my('native', 'compound'), loops: my('native', 'compound'), cursors: my('native', 'compound'), handlers: my('native', 'compound'),
    signals: my('native', 'compound', { nativeName: 'SIGNAL/RESIGNAL' }), dynamicSql: my('partial', 'restrictions', { nativeName: 'PREPARE/EXECUTE', restrictions: ['Stored-program context restrictions apply.'] }),
    triggers: my('native', 'triggers'), scheduledEvents: my('native', 'events'), anonymousBlocks: my('unsupported', 'compound'), packages: my('unsupported', 'routines'),
    deterministicFunctions: my('native', 'routines'), sqlSecurity: my('native', 'routines', { syntax: 'SQL SECURITY DEFINER | INVOKER' })
  },

  administration: {
    explain: my('native', 'explain'), explainAnalyze: my('native', 'explain'), explainTree: my('native', 'explain'), explainJson: my('native', 'explain'),
    analyzeTable: my('native', 'analyze'), histograms: my('native', 'analyze'), optimizeTable: my('native', 'optimize'), checkTable: my('native', 'optimize'), repairTable: my('partial', 'optimize'),
    sessionSettings: my('native', 'systemVariables'), globalSettings: my('native', 'systemVariables'), persistentSettings: my('native', 'systemVariables'),
    performanceSchema: my('native', 'performanceSchema'), sysSchema: my('native', 'performanceSchema'), informationSchema: my('native', 'performanceSchema'),
    optimizerHints: my('native', 'optimizerHints'), indexHints: my('native', 'optimizerHints'), optimizerSwitch: my('native', 'systemVariables'),
    processList: my('native', 'performanceSchema'), killSession: my('native', 'systemVariables'), vacuum: my('not-applicable', 'optimize')
  },

  dataMovement: {
    bulkLoad: my('native', 'loadData', { nativeName: 'LOAD DATA', syntax: 'LOAD DATA' }), localBulkLoad: my('native', 'loadData', { syntax: 'LOAD DATA LOCAL' }),
    partitionTargetedLoad: my('native', 'loadData'), bulkExport: my('native', 'outfile', { nativeName: 'SELECT ... INTO OUTFILE' }), dumpFile: my('native', 'outfile'),
    loadXml: my('native', 'loadData', { nativeName: 'LOAD XML' }), federatedQueries: my('partial', 'storageEngines', { nativeName: 'FEDERATED', restrictions: ['Requires FEDERATED storage-engine availability/configuration.'] }),
    replication: my('native', 'replication'), binaryLog: my('native', 'replication'), groupReplication: my('native', 'replication')
  },

  extensions: {
    pluginFramework: my('native', 'plugins'), componentFramework: my('native', 'plugins'), storageEngines: my('native', 'storageEngines'),
    authenticationPlugins: my('native', 'plugins'), auditPlugins: my('native', 'plugins'), fullTextParserPlugins: my('native', 'plugins'),
    udf: my('native', 'plugins', { nativeName: 'loadable functions/UDFs' }), ndbCluster: my('native', 'storageEngines', { nativeName: 'NDB' })
  },

  types: {
    tinyint: my('native', 'types'), smallint: my('native', 'types'), mediumint: my('native', 'types'), integer: my('native', 'types'), bigint: my('native', 'types'),
    decimal: my('native', 'types'), float: my('native', 'types'), double: my('native', 'types'), bit: my('native', 'types'),
    boolean: my('equivalent', 'types', { nativeName: 'TINYINT(1)' }), date: my('native', 'types'), time: my('native', 'types'), datetime: my('native', 'types'), timestamp: my('native', 'types'), year: my('native', 'types'),
    char: my('native', 'types'), varchar: my('native', 'types'), binary: my('native', 'types'), varbinary: my('native', 'types'), text: my('native', 'types'), blob: my('native', 'types'),
    enum: my('native', 'types'), set: my('native', 'types'), json: my('native', 'json'), spatial: my('native', 'types'),
    arrays: my('unsupported', 'types'), uuid: my('equivalent', 'types', { notes: 'UUID values use character or binary storage; MySQL exposes UUID functions rather than a native UUID type.' }),
    domains: my('unsupported', 'types'), composite: my('unsupported', 'types'), ranges: my('unsupported', 'types')
  },

  functions: {
    scalar: my('native', 'select'), aggregate: my('native', 'select'), windowFunctions: my('native', 'windows'), storedFunctions: my('native', 'routines'),
    loadableFunctions: my('native', 'plugins'), jsonFunctions: my('native', 'json'), spatialFunctions: my('native', 'types'), regexFunctions: my('native', 'select'),
    dateTimeFunctions: my('native', 'types'), uuidFunctions: my('native', 'types'), tableFunctions: my('partial', 'json', { nativeName: 'JSON_TABLE' })
  },

  operators: {
    arithmetic: my('native', 'select'), comparison: my('native', 'select'), logical: my('native', 'select'), assignment: my('native', 'select'),
    jsonOperators: my('native', 'json', { aliases: ['->', '->>'] }), regexOperators: my('native', 'select'), nullSafeEquality: my('native', 'select', { syntax: '<=>' }),
    userDefinedOperators: my('unsupported', 'plugins')
  },

  keywords: {
    catalogued: my('native', 'select', { nativeName: 'INFORMATION_SCHEMA.KEYWORDS' }), reservedClassification: my('native', 'select', { nativeName: 'INFORMATION_SCHEMA.KEYWORDS' })
  },

  syntax: {
    returning: my('unsupported', 'insert'), conflictHandling: my('equivalent', 'insert', { nativeName: 'ON DUPLICATE KEY UPDATE' }),
    replace: my('native', 'insert', { syntax: 'REPLACE', standard: 'MySQL extension' }), ignoreModifier: my('native', 'insert', { syntax: 'IGNORE', standard: 'MySQL extension' }),
    straightJoin: my('native', 'select', { syntax: 'STRAIGHT_JOIN', standard: 'MySQL extension' }), limit: my('native', 'select'),
    indexHints: my('native', 'optimizerHints', { syntax: 'USE INDEX | FORCE INDEX | IGNORE INDEX' }), optimizerHints: my('native', 'optimizerHints'),
    nullSafeEquality: my('native', 'select', { syntax: '<=>', standard: 'MySQL extension' }),
    delimiterClientDirective: my('not-applicable', 'routines', { notes: 'DELIMITER is a mysql client command, not server SQL syntax.' })
  },

  limits: {
    serverVariablesQueryable: my('native', 'systemVariables', { nativeName: 'SHOW VARIABLES/performance_schema.variables_*' }),
    maxConnections: my('native', 'systemVariables'), maxAllowedPacket: my('native', 'systemVariables'), maxPreparedStmtCount: my('native', 'systemVariables'),
    groupConcatMaxLen: my('native', 'systemVariables'), maxExecutionTime: my('native', 'systemVariables'), lockWaitTimeout: my('native', 'systemVariables'),
    innodbLockWaitTimeout: my('native', 'systemVariables'), tmpTableSize: my('native', 'systemVariables'), maxHeapTableSize: my('native', 'systemVariables'),
    runtimeQueryable: my('partial', 'systemVariables', { notes: 'Many operational limits are server variables while additional limits are storage-engine or implementation constraints.' })
  }
}, {
  coverage: 'exhaustive-v1',
  evidenceRegister: Object.keys(R).map(function (key) { return R[key]; })
});
