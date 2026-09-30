'use strict';

var model = require('../Model');
var f = model.feature;

var R = Object.freeze({
  select: 'https://www.postgresql.org/docs/18/sql-select.html',
  insert: 'https://www.postgresql.org/docs/18/sql-insert.html',
  update: 'https://www.postgresql.org/docs/18/sql-update.html',
  delete: 'https://www.postgresql.org/docs/18/sql-delete.html',
  merge: 'https://www.postgresql.org/docs/18/sql-merge.html',
  createTable: 'https://www.postgresql.org/docs/18/sql-createtable.html',
  createIndex: 'https://www.postgresql.org/docs/18/sql-createindex.html',
  views: 'https://www.postgresql.org/docs/18/sql-createview.html',
  materializedViews: 'https://www.postgresql.org/docs/18/rules-materializedviews.html',
  generated: 'https://www.postgresql.org/docs/18/ddl-generated-columns.html',
  constraints: 'https://www.postgresql.org/docs/18/ddl-constraints.html',
  types: 'https://www.postgresql.org/docs/18/datatype.html',
  functions: 'https://www.postgresql.org/docs/18/functions.html',
  createFunction: 'https://www.postgresql.org/docs/18/sql-createfunction.html',
  createProcedure: 'https://www.postgresql.org/docs/18/sql-createprocedure.html',
  plpgsql: 'https://www.postgresql.org/docs/18/plpgsql.html',
  transactions: 'https://www.postgresql.org/docs/18/transaction-iso.html',
  locks: 'https://www.postgresql.org/docs/18/explicit-locking.html',
  adminFunctions: 'https://www.postgresql.org/docs/18/functions-admin.html',
  explain: 'https://www.postgresql.org/docs/18/sql-explain.html',
  vacuum: 'https://www.postgresql.org/docs/18/sql-vacuum.html',
  analyze: 'https://www.postgresql.org/docs/18/sql-analyze.html',
  reindex: 'https://www.postgresql.org/docs/18/sql-reindex.html',
  copy: 'https://www.postgresql.org/docs/18/sql-copy.html',
  rowSecurity: 'https://www.postgresql.org/docs/18/ddl-rowsecurity.html',
  roles: 'https://www.postgresql.org/docs/18/user-manag.html',
  fdw: 'https://www.postgresql.org/docs/18/ddl-foreign-data.html',
  replication: 'https://www.postgresql.org/docs/18/logical-replication.html',
  extensions: 'https://www.postgresql.org/docs/18/external-extensions.html',
  stats: 'https://www.postgresql.org/docs/18/monitoring-stats.html',
  config: 'https://www.postgresql.org/docs/18/runtime-config.html',
  release18: 'https://www.postgresql.org/docs/18/release-18.html'
});

function pg(support, reference, options) {
  options = Object.assign({}, options || {});
  options.references = (options.references || []).slice();
  if (reference && R[reference]) options.references.unshift(R[reference]);
  return f(support, options);
}

module.exports = model.createModel('postgresql', {
  family: 'postgresql',
  name: 'PostgreSQL',
  referenceVersion: '18',
  versionPolicy: 'server-evidence'
}, {
  statements: {
    select: pg('native', 'select'),
    insert: pg('native', 'insert'),
    update: pg('native', 'update'),
    delete: pg('native', 'delete'),
    merge: pg('native', 'merge', { since: '15', syntax: 'MERGE' }),
    values: pg('native', 'select', { syntax: 'VALUES' }),
    table: pg('native', 'select', { syntax: 'TABLE' }),
    createTable: pg('native', 'createTable'),
    createTableAs: pg('native', 'createTable', { syntax: 'CREATE TABLE ... AS' }),
    alterTable: pg('native', 'createTable'),
    dropTable: pg('native', 'createTable'),
    truncate: pg('native', 'createTable', { syntax: 'TRUNCATE' }),
    createView: pg('native', 'views'),
    createMaterializedView: pg('native', 'materializedViews'),
    refreshMaterializedView: pg('native', 'materializedViews', { syntax: 'REFRESH MATERIALIZED VIEW' }),
    createIndex: pg('native', 'createIndex'),
    createSchema: pg('native', 'createTable'),
    createDatabase: pg('native', 'createTable'),
    createSequence: pg('native', 'createTable'),
    createType: pg('native', 'types'),
    createDomain: pg('native', 'types'),
    createFunction: pg('native', 'createFunction'),
    createProcedure: pg('native', 'createProcedure'),
    createTrigger: pg('native', 'createFunction'),
    grant: pg('native', 'roles'),
    revoke: pg('native', 'roles'),
    setRole: pg('native', 'roles', { syntax: 'SET ROLE' }),
    setSessionAuthorization: pg('native', 'roles', { syntax: 'SET SESSION AUTHORIZATION' }),
    begin: pg('native', 'transactions', { aliases: ['START TRANSACTION'] }),
    commit: pg('native', 'transactions'),
    rollback: pg('native', 'transactions'),
    savepoint: pg('native', 'transactions'),
    releaseSavepoint: pg('native', 'transactions'),
    prepareTransaction: pg('native', 'transactions', { nativeName: 'two-phase commit' }),
    commitPrepared: pg('native', 'transactions'),
    rollbackPrepared: pg('native', 'transactions'),
    copy: pg('native', 'copy'),
    call: pg('native', 'createProcedure', { syntax: 'CALL' }),
    do: pg('native', 'plpgsql', { syntax: 'DO' }),
    explain: pg('native', 'explain'),
    analyze: pg('native', 'analyze'),
    vacuum: pg('native', 'vacuum'),
    reindex: pg('native', 'reindex'),
    cluster: pg('native', 'createIndex', { syntax: 'CLUSTER' }),
    checkpoint: pg('native', 'adminFunctions'),
    set: pg('native', 'config'),
    show: pg('native', 'config'),
    reset: pg('native', 'config'),
    discard: pg('native', 'config')
  },

  queries: {
    joins: {
      inner: pg('native', 'select'), left: pg('native', 'select'), right: pg('native', 'select'),
      full: pg('native', 'select'), cross: pg('native', 'select'), natural: pg('native', 'select'),
      lateral: pg('native', 'select', { syntax: 'LATERAL' })
    },
    subqueries: {
      scalar: pg('native', 'functions'), correlated: pg('native', 'functions'), exists: pg('native', 'functions'),
      in: pg('native', 'functions'), anyAll: pg('native', 'functions'), derivedTables: pg('native', 'select')
    },
    cte: {
      ordinary: pg('native', 'select', { syntax: 'WITH' }),
      recursive: pg('native', 'select', { syntax: 'WITH RECURSIVE' }),
      dataModifying: pg('native', 'select', { syntax: 'WITH ... INSERT/UPDATE/DELETE/MERGE' }),
      materializationHints: pg('native', 'select', { since: '12', syntax: 'MATERIALIZED | NOT MATERIALIZED' }),
      search: pg('native', 'select', { syntax: 'SEARCH DEPTH FIRST | BREADTH FIRST' }),
      cycle: pg('native', 'select', { syntax: 'CYCLE' })
    },
    setOperators: {
      union: pg('native', 'select'), unionAll: pg('native', 'select'),
      intersect: pg('native', 'select'), intersectAll: pg('native', 'select'),
      except: pg('native', 'select'), exceptAll: pg('native', 'select')
    },
    grouping: {
      groupBy: pg('native', 'select'), having: pg('native', 'select'), groupingSets: pg('native', 'select'),
      rollup: pg('native', 'select'), cube: pg('native', 'select')
    },
    windows: {
      supported: pg('native', 'select'), named: pg('native', 'select'),
      rows: pg('native', 'select'), range: pg('native', 'select'), groups: pg('native', 'select'),
      exclude: pg('native', 'select')
    },
    distinct: { standard: pg('native', 'select'), on: pg('native', 'select', { syntax: 'DISTINCT ON', standard: 'PostgreSQL extension' }) },
    ordering: { orderBy: pg('native', 'select'), nullsFirstLast: pg('native', 'select') },
    pagination: {
      limit: pg('native', 'select'), offset: pg('native', 'select'), fetch: pg('native', 'select'),
      withTies: pg('native', 'select', { syntax: 'FETCH ... WITH TIES' })
    },
    locking: {
      forUpdate: pg('native', 'select'), forNoKeyUpdate: pg('native', 'select'), forShare: pg('native', 'select'),
      forKeyShare: pg('native', 'select'), nowait: pg('native', 'select'), skipLocked: pg('native', 'select')
    },
    tableSampling: { system: pg('native', 'select'), bernoulli: pg('native', 'select'), repeatable: pg('native', 'select') },
    tableFunctions: {
      supported: pg('native', 'functions'), lateralImplicit: pg('native', 'select'), rowsFrom: pg('native', 'select'), withOrdinality: pg('native', 'select')
    }
  },

  schema: {
    table: pg('native', 'createTable'),
    temporaryTable: pg('native', 'createTable'),
    unloggedTable: pg('native', 'createTable'),
    inheritedTable: pg('native', 'createTable'),
    partitionedTable: pg('native', 'createTable'),
    typedTable: pg('native', 'createTable'),
    view: pg('native', 'views'),
    recursiveView: pg('native', 'views'),
    securityBarrierView: pg('native', 'views'),
    securityInvokerView: pg('native', 'views'),
    materializedView: pg('native', 'materializedViews'),
    index: pg('native', 'createIndex'),
    uniqueIndex: pg('native', 'createIndex'),
    partialIndex: pg('native', 'createIndex'),
    expressionIndex: pg('native', 'createIndex'),
    coveringIndex: pg('native', 'createIndex', { nativeName: 'INCLUDE' }),
    concurrentIndexBuild: pg('native', 'createIndex', { syntax: 'CREATE INDEX CONCURRENTLY' }),
    sequence: pg('native', 'createTable'),
    schema: pg('native', 'createTable'),
    database: pg('native', 'createTable'),
    function: pg('native', 'createFunction'),
    procedure: pg('native', 'createProcedure'),
    aggregate: pg('native', 'functions'),
    trigger: pg('native', 'createFunction'),
    eventTrigger: pg('native', 'createFunction'),
    domain: pg('native', 'types'),
    enum: pg('native', 'types'),
    compositeType: pg('native', 'types'),
    rangeType: pg('native', 'types'),
    multirangeType: pg('native', 'types'),
    baseType: pg('native', 'types'),
    collation: pg('native', 'types'),
    conversion: pg('native', 'types'),
    operator: pg('native', 'functions'),
    operatorClass: pg('native', 'createIndex'),
    operatorFamily: pg('native', 'createIndex'),
    policy: pg('native', 'rowSecurity'),
    extendedStatistics: pg('native', 'stats'),
    publication: pg('native', 'replication'),
    subscription: pg('native', 'replication'),
    foreignDataWrapper: pg('native', 'fdw'),
    foreignServer: pg('native', 'fdw'),
    userMapping: pg('native', 'fdw'),
    foreignTable: pg('native', 'fdw'),
    extension: pg('native', 'extensions'),
    accessMethod: pg('native', 'createIndex')
  },

  expressions: {
    arithmetic: pg('native', 'functions'), comparison: pg('native', 'functions'), boolean: pg('native', 'functions'),
    threeValuedLogic: pg('native', 'functions'),
    caseExpression: pg('native', 'functions'), coalesce: pg('native', 'functions'), nullif: pg('native', 'functions'),
    greatestLeast: pg('native', 'functions'), cast: pg('native', 'functions', { aliases: ['::'] }),
    collations: pg('native', 'functions'), rowConstructors: pg('native', 'functions'),
    arrays: pg('native', 'functions'), arraySubscripting: pg('native', 'functions'), arraySlices: pg('native', 'functions'),
    json: pg('native', 'functions', { nativeName: 'json/jsonb' }), jsonPath: pg('native', 'functions'), jsonTable: pg('native', 'functions'),
    ranges: pg('native', 'functions'), multiranges: pg('native', 'functions'),
    regex: pg('native', 'functions', { nativeName: 'POSIX regular expressions' }), like: pg('native', 'functions'),
    ilike: pg('native', 'functions', { standard: 'PostgreSQL extension' }), similarTo: pg('native', 'functions'),
    dateTime: pg('native', 'functions'), intervals: pg('native', 'functions'),
    xml: pg('native', 'functions'), sequenceExpressions: pg('native', 'functions'),
    aggregateFilter: pg('native', 'functions', { syntax: 'FILTER (WHERE ...)' }),
    withinGroup: pg('native', 'functions', { syntax: 'WITHIN GROUP' }),
    namedFunctionArguments: pg('native', 'functions'), variadicArguments: pg('native', 'functions')
  },

  integrity: {
    notNull: pg('native', 'constraints'), check: pg('native', 'constraints'), unique: pg('native', 'constraints'),
    primaryKey: pg('native', 'constraints'), foreignKey: pg('native', 'constraints'), exclusion: pg('native', 'constraints'),
    uniqueNullsNotDistinct: pg('native', 'createIndex', { syntax: 'NULLS NOT DISTINCT' }),
    deferrableUnique: pg('native', 'createTable'), deferrablePrimaryKey: pg('native', 'createTable'),
    deferrableForeignKeys: pg('native', 'createTable'), deferrableExclusion: pg('native', 'createTable'),
    initiallyDeferred: pg('native', 'createTable'), initiallyImmediate: pg('native', 'createTable'),
    onDeleteCascade: pg('native', 'constraints'), onDeleteSetNull: pg('native', 'constraints'),
    onDeleteSetDefault: pg('native', 'constraints'), onDeleteRestrict: pg('native', 'constraints'),
    onDeleteNoAction: pg('native', 'constraints'),
    onUpdateCascade: pg('native', 'constraints'), onUpdateSetNull: pg('native', 'constraints'),
    onUpdateSetDefault: pg('native', 'constraints'), onUpdateRestrict: pg('native', 'constraints'),
    onUpdateNoAction: pg('native', 'constraints'),
    generatedColumns: pg('native', 'generated'),
    generatedStored: pg('native', 'generated'), generatedVirtual: pg('native', 'generated', { since: '18' }),
    identity: pg('native', 'createTable', { syntax: 'GENERATED ... AS IDENTITY' }),
    identityAlways: pg('native', 'createTable'), identityByDefault: pg('native', 'createTable'),
    temporalWithoutOverlaps: pg('native', 'release18', { since: '18', syntax: 'WITHOUT OVERLAPS' }),
    temporalPeriodForeignKey: pg('native', 'release18', { since: '18', syntax: 'PERIOD' })
  },

  physical: {
    partitioning: pg('native', 'createTable'),
    partitionRange: pg('native', 'createTable'), partitionList: pg('native', 'createTable'), partitionHash: pg('native', 'createTable'),
    defaultPartition: pg('native', 'createTable'), subpartitioning: pg('native', 'createTable'), partitionPruning: pg('native', 'createTable'),
    inheritance: pg('native', 'createTable'), temporaryRelations: pg('native', 'createTable'), unloggedRelations: pg('native', 'createTable'),
    tablespaces: pg('native', 'createTable'), tableAccessMethods: pg('native', 'createTable'),
    indexBtree: pg('native', 'createIndex'), indexHash: pg('native', 'createIndex'), indexGiST: pg('native', 'createIndex'),
    indexSPGiST: pg('native', 'createIndex'), indexGIN: pg('native', 'createIndex'), indexBRIN: pg('native', 'createIndex'),
    clustering: pg('native', 'createIndex', { syntax: 'CLUSTER' }),
    toast: pg('native', 'createTable', { nativeName: 'TOAST' }),
    storageParameters: pg('native', 'createTable'), fillfactor: pg('native', 'createTable'),
    columnStorage: pg('native', 'createTable'), columnCompression: pg('native', 'createTable'),
    nativeSharding: pg('unsupported', 'createTable', { notes: 'Core PostgreSQL does not provide transparent native sharding; extensions or external systems are used.' }),
    nativeColumnstore: pg('unsupported', 'createTable')
  },

  security: {
    usersAndRoles: pg('native', 'roles', { nativeName: 'roles' }), loginRoles: pg('native', 'roles'), roleMembership: pg('native', 'roles'),
    grants: pg('native', 'roles'), revokes: pg('native', 'roles'), columnPrivileges: pg('native', 'roles'), defaultPrivileges: pg('native', 'roles'),
    ownership: pg('native', 'roles'), schemaPrivileges: pg('native', 'roles'),
    rowLevelSecurity: pg('native', 'rowSecurity'), rlsPolicies: pg('native', 'rowSecurity'), permissivePolicies: pg('native', 'rowSecurity'),
    restrictivePolicies: pg('native', 'rowSecurity'), policyUsing: pg('native', 'rowSecurity'), policyWithCheck: pg('native', 'rowSecurity'),
    bypassRls: pg('native', 'rowSecurity'), securityDefiner: pg('native', 'createFunction'), securityInvoker: pg('native', 'createFunction'),
    impersonation: pg('equivalent', 'roles', { nativeName: 'SET ROLE / SET SESSION AUTHORIZATION' }),
    rolePasswords: pg('native', 'roles'),
    dynamicDataMasking: pg('unsupported', 'rowSecurity', { notes: 'Core PostgreSQL has no SQL Server-style dynamic data masking feature.' }),
    transparentDataEncryption: pg('unsupported', 'roles', { notes: 'Core PostgreSQL does not provide built-in transparent data encryption.' })
  },

  transactions: {
    transactions: pg('native', 'transactions'), mvcc: pg('native', 'transactions'),
    readCommitted: pg('native', 'transactions'), repeatableRead: pg('native', 'transactions'), serializable: pg('native', 'transactions'),
    readUncommitted: pg('equivalent', 'transactions', { nativeName: 'READ COMMITTED', notes: 'PostgreSQL treats READ UNCOMMITTED as READ COMMITTED.' }),
    readOnly: pg('native', 'transactions'), readWrite: pg('native', 'transactions'), deferrable: pg('native', 'transactions'),
    savepoints: pg('native', 'transactions'), nestedTransactions: pg('emulated', 'transactions', { nativeName: 'savepoints' }),
    twoPhaseCommit: pg('native', 'transactions', { nativeName: 'prepared transactions' }),
    rowLocks: pg('native', 'locks'), tableLocks: pg('native', 'locks'), advisoryLocks: pg('native', 'adminFunctions'),
    nowait: pg('native', 'locks'), skipLocked: pg('native', 'locks'), predicateLocks: pg('native', 'transactions'),
    autonomousTransactions: pg('unsupported', 'transactions')
  },

  programmability: {
    procedures: pg('native', 'createProcedure'), functions: pg('native', 'createFunction'),
    sqlLanguageFunctions: pg('native', 'createFunction'), plpgsql: pg('native', 'plpgsql'),
    additionalProceduralLanguages: pg('native', 'extensions', { notes: 'Additional procedural languages may be installed as extensions.' }),
    anonymousBlocks: pg('native', 'plpgsql', { syntax: 'DO' }),
    variables: pg('native', 'plpgsql'), assignment: pg('native', 'plpgsql'), conditionals: pg('native', 'plpgsql'),
    loops: pg('native', 'plpgsql'), cursors: pg('native', 'plpgsql'), exceptions: pg('native', 'plpgsql'),
    dynamicSql: pg('native', 'plpgsql', { nativeName: 'EXECUTE' }), records: pg('native', 'plpgsql'),
    triggers: pg('native', 'createFunction'), eventTriggers: pg('native', 'createFunction'),
    functionVolatility: pg('native', 'createFunction', { syntax: 'IMMUTABLE | STABLE | VOLATILE' }),
    strictFunctions: pg('native', 'createFunction', { syntax: 'STRICT | RETURNS NULL ON NULL INPUT' }),
    parallelSafety: pg('native', 'createFunction'), functionCostRows: pg('native', 'createFunction'),
    procedureTransactionControl: pg('partial', 'createProcedure', { notes: 'Procedures may perform transaction control only in permitted CALL/DO execution contexts.' })
  },

  administration: {
    explain: pg('native', 'explain'), explainAnalyze: pg('native', 'explain'), explainJson: pg('native', 'explain'),
    explainXml: pg('native', 'explain'), explainYaml: pg('native', 'explain'), explainBuffers: pg('native', 'explain'),
    explainWal: pg('native', 'explain'), explainMemory: pg('native', 'explain', { since: '18' }),
    analyze: pg('native', 'analyze'), vacuum: pg('native', 'vacuum'), vacuumFull: pg('native', 'vacuum'),
    vacuumFreeze: pg('native', 'vacuum'), vacuumAnalyze: pg('native', 'vacuum'), parallelVacuum: pg('native', 'vacuum'),
    reindex: pg('native', 'reindex'), reindexConcurrently: pg('native', 'reindex'), cluster: pg('native', 'createIndex'),
    checkpoint: pg('native', 'adminFunctions'), sessionSettings: pg('native', 'config'), localSettings: pg('native', 'config'),
    statisticsViews: pg('native', 'stats'), extendedStatistics: pg('native', 'stats'), lockMonitoring: pg('native', 'stats', { nativeName: 'pg_locks' }),
    cancelBackend: pg('native', 'adminFunctions'), terminateBackend: pg('native', 'adminFunctions'),
    prepareExecute: pg('native', 'select'), coreQueryHints: pg('unsupported', 'explain', { notes: 'Core PostgreSQL does not provide a general optimizer hint syntax.' })
  },

  dataMovement: {
    bulkLoad: pg('native', 'copy', { nativeName: 'COPY FROM', syntax: 'COPY ... FROM' }),
    bulkExport: pg('native', 'copy', { nativeName: 'COPY TO', syntax: 'COPY ... TO' }),
    stdin: pg('native', 'copy'), stdout: pg('native', 'copy'), serverFile: pg('native', 'copy'), serverProgram: pg('native', 'copy'),
    textFormat: pg('native', 'copy'), csvFormat: pg('native', 'copy'), binaryFormat: pg('native', 'copy'),
    copyWhere: pg('native', 'copy'), copyFreeze: pg('native', 'copy'),
    foreignTables: pg('native', 'fdw'), foreignDataWrappers: pg('native', 'fdw'),
    logicalReplication: pg('native', 'replication'), publications: pg('native', 'replication'), subscriptions: pg('native', 'replication'),
    largeObjects: pg('native', 'functions')
  },

  extensions: {
    extensionFramework: pg('native', 'extensions', { syntax: 'CREATE EXTENSION' }),
    extensionUpgrade: pg('native', 'extensions', { syntax: 'ALTER EXTENSION ... UPDATE' }),
    proceduralLanguages: pg('native', 'extensions'),
    foreignDataWrapperFramework: pg('native', 'fdw'),
    customTypes: pg('native', 'types'), customOperators: pg('native', 'functions'), customAggregates: pg('native', 'functions'),
    customIndexOperatorClasses: pg('native', 'createIndex'), customAccessMethods: pg('native', 'createIndex'),
    listenNotify: pg('native', 'adminFunctions'), logicalDecoding: pg('native', 'replication')
  },

  types: {
    boolean: pg('native', 'types'), smallint: pg('native', 'types'), integer: pg('native', 'types'), bigint: pg('native', 'types'),
    numeric: pg('native', 'types'), real: pg('native', 'types'), doublePrecision: pg('native', 'types'), money: pg('native', 'types'),
    char: pg('native', 'types'), varchar: pg('native', 'types'), text: pg('native', 'types'), bytea: pg('native', 'types'),
    date: pg('native', 'types'), time: pg('native', 'types'), timeWithTimeZone: pg('native', 'types'), timestamp: pg('native', 'types'),
    timestampWithTimeZone: pg('native', 'types'), interval: pg('native', 'types'),
    enum: pg('native', 'types'), geometric: pg('native', 'types'), network: pg('native', 'types'), bitString: pg('native', 'types'),
    textSearch: pg('native', 'types'), uuid: pg('native', 'types'), xml: pg('native', 'types'), json: pg('native', 'types'), jsonb: pg('native', 'types'),
    arrays: pg('native', 'types'), composite: pg('native', 'types'), record: pg('native', 'types'), ranges: pg('native', 'types'), multiranges: pg('native', 'types'),
    domains: pg('native', 'types'), objectIdentifiers: pg('native', 'types'), pgLsn: pg('native', 'types'), pseudoTypes: pg('native', 'types'),
    serial: pg('equivalent', 'types', { nativeName: 'sequence-backed integer pseudo-type', equivalentTo: ['identity', 'sequence'] })
  },

  functions: {
    scalar: pg('native', 'functions'), aggregate: pg('native', 'functions'), orderedSetAggregate: pg('native', 'functions'),
    hypotheticalSetAggregate: pg('native', 'functions'), window: pg('native', 'functions'), setReturning: pg('native', 'functions'),
    tableFunctions: pg('native', 'functions'), userDefined: pg('native', 'createFunction'), polymorphic: pg('native', 'createFunction'),
    variadic: pg('native', 'createFunction'), json: pg('native', 'functions'), xml: pg('native', 'functions'), uuid: pg('native', 'functions'),
    sequence: pg('native', 'functions'), administration: pg('native', 'adminFunctions'), statistics: pg('native', 'stats'), triggerFunctions: pg('native', 'createFunction')
  },

  operators: {
    userDefined: pg('native', 'functions'), operatorClasses: pg('native', 'createIndex'), operatorFamilies: pg('native', 'createIndex'),
    comparison: pg('native', 'functions'), arithmetic: pg('native', 'functions'), pattern: pg('native', 'functions'), regex: pg('native', 'functions'),
    jsonOperators: pg('native', 'functions'), arrayOperators: pg('native', 'functions'), rangeOperators: pg('native', 'functions'),
    networkOperators: pg('native', 'functions'), textSearchOperators: pg('native', 'functions'), geometricOperators: pg('native', 'functions')
  },

  keywords: {
    catalogued: pg('native', 'select', { nativeName: 'pg_get_keywords()' }),
    reservedClassification: pg('native', 'select', { nativeName: 'pg_get_keywords()' })
  },

  syntax: {
    returning: pg('native', 'insert', { syntax: 'RETURNING' }),
    returningOldNew: pg('native', 'release18', { since: '18', syntax: 'RETURNING WITH (OLD AS ..., NEW AS ...)' }),
    conflictHandling: pg('native', 'insert', { syntax: 'ON CONFLICT' }),
    distinctOn: pg('native', 'select', { syntax: 'DISTINCT ON', standard: 'PostgreSQL extension' }),
    filter: pg('native', 'functions', { syntax: 'FILTER (WHERE ...)' }), withinGroup: pg('native', 'functions', { syntax: 'WITHIN GROUP' }),
    castShorthand: pg('native', 'functions', { syntax: '::', standard: 'PostgreSQL extension' }), ilike: pg('native', 'functions'),
    similarTo: pg('native', 'functions'), isDistinctFrom: pg('native', 'functions'), nullsFirstLast: pg('native', 'select'),
    only: pg('native', 'select'), tableSample: pg('native', 'select'), overridingSystemValue: pg('native', 'insert'),
    overridingUserValue: pg('native', 'insert'), onCommit: pg('native', 'createTable'), search: pg('native', 'select'), cycle: pg('native', 'select')
  },

  limits: {
    serverSettingsQueryable: pg('native', 'config', { nativeName: 'SHOW/current_setting' }),
    statementTimeout: pg('native', 'config'), lockTimeout: pg('native', 'config'), idleInTransactionSessionTimeout: pg('native', 'config'),
    maxConnections: pg('native', 'config'), maxPreparedTransactions: pg('native', 'config'), workMem: pg('native', 'config'),
    tempFileLimit: pg('native', 'config'), maxLocksPerTransaction: pg('native', 'config'), maxStackDepth: pg('native', 'config'),
    identifierLength: pg('partial', 'config', { notes: 'Identifier length is implementation-defined and commonly 63 bytes in standard builds.' }),
    runtimeQueryable: pg('partial', 'config', { notes: 'Many operational limits are queryable/configurable, while some implementation limits are compile-time or internal.' })
  }
}, {
  coverage: 'exhaustive-v1',
  evidenceRegister: Object.keys(R).map(function (key) { return R[key]; })
});
