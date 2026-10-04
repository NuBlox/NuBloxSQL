'use strict';

var model = require('../Model');
var f = model.feature;

var R = Object.freeze({
  language: 'https://www.sqlite.org/lang.html',
  select: 'https://www.sqlite.org/lang_select.html',
  insert: 'https://www.sqlite.org/lang_insert.html',
  update: 'https://www.sqlite.org/lang_update.html',
  delete: 'https://www.sqlite.org/lang_delete.html',
  createTable: 'https://www.sqlite.org/lang_createtable.html',
  alterTable: 'https://www.sqlite.org/lang_altertable.html',
  createIndex: 'https://www.sqlite.org/lang_createindex.html',
  partialIndex: 'https://www.sqlite.org/partialindex.html',
  exprIndex: 'https://www.sqlite.org/expridx.html',
  withoutRowid: 'https://www.sqlite.org/withoutrowid.html',
  strict: 'https://www.sqlite.org/stricttables.html',
  generated: 'https://www.sqlite.org/gencol.html',
  with: 'https://www.sqlite.org/lang_with.html',
  windows: 'https://www.sqlite.org/windowfunctions.html',
  returning: 'https://www.sqlite.org/lang_returning.html',
  upsert: 'https://www.sqlite.org/lang_upsert.html',
  conflict: 'https://www.sqlite.org/lang_conflict.html',
  datatype: 'https://www.sqlite.org/datatype3.html',
  json: 'https://www.sqlite.org/json1.html',
  foreignKeys: 'https://www.sqlite.org/foreignkeys.html',
  transactions: 'https://www.sqlite.org/lang_transaction.html',
  locking: 'https://www.sqlite.org/lockingv3.html',
  wal: 'https://www.sqlite.org/wal.html',
  pragma: 'https://www.sqlite.org/pragma.html',
  vacuum: 'https://www.sqlite.org/lang_vacuum.html',
  analyze: 'https://www.sqlite.org/lang_analyze.html',
  explain: 'https://www.sqlite.org/eqp.html',
  limits: 'https://www.sqlite.org/limits.html',
  attach: 'https://www.sqlite.org/lang_attach.html',
  virtualTables: 'https://www.sqlite.org/vtab.html',
  fts5: 'https://www.sqlite.org/fts5.html',
  rtree: 'https://www.sqlite.org/rtree.html',
  loadExtension: 'https://www.sqlite.org/loadext.html',
  session: 'https://www.sqlite.org/sessionintro.html',
  compile: 'https://www.sqlite.org/compile.html',
  dateTime: 'https://www.sqlite.org/lang_datefunc.html'
});

function sq(support, reference, options) {
  options = Object.assign({}, options || {});
  options.references = (options.references || []).slice();
  if (reference && R[reference]) options.references.unshift(R[reference]);
  return f(support, options);
}

module.exports = model.createModel('sqlite', {
  family: 'sqlite',
  name: 'SQLite',
  referenceVersion: 'runtime',
  versionPolicy: 'runtime-probe'
}, {
  statements: {
    select: sq('native', 'select'), insert: sq('native', 'insert'), update: sq('native', 'update'), delete: sq('native', 'delete'),
    replace: sq('native', 'insert', { nativeName: 'REPLACE / INSERT OR REPLACE', standard: 'SQLite extension' }), merge: sq('unsupported', 'language'),
    createTable: sq('native', 'createTable'), createTableAs: sq('native', 'createTable', { syntax: 'CREATE TABLE ... AS SELECT ...' }), alterTable: sq('partial', 'alterTable', { notes: 'SQLite ALTER TABLE intentionally supports a narrower operation set than server databases.' }),
    dropTable: sq('native', 'createTable'), createView: sq('native', 'language'), dropView: sq('native', 'language'),
    createIndex: sq('native', 'createIndex'), dropIndex: sq('native', 'createIndex'), createTrigger: sq('native', 'language'), dropTrigger: sq('native', 'language'),
    attach: sq('native', 'attach'), detach: sq('native', 'attach'), begin: sq('native', 'transactions'), commit: sq('native', 'transactions'), rollback: sq('native', 'transactions'),
    savepoint: sq('native', 'transactions'), releaseSavepoint: sq('native', 'transactions'),
    vacuum: sq('native', 'vacuum'), analyze: sq('native', 'analyze'), reindex: sq('native', 'language'), pragma: sq('native', 'pragma'),
    grant: sq('not-applicable', 'language'), revoke: sq('not-applicable', 'language'), createUser: sq('not-applicable', 'language'), createRole: sq('not-applicable', 'language')
  },

  queries: {
    joins: {
      inner: sq('native', 'select'), left: sq('native', 'select'), cross: sq('native', 'select'), natural: sq('native', 'select'),
      right: sq('runtime-dependent', 'select', { since: '3.39.0', evidence: 'runtime-version' }),
      full: sq('runtime-dependent', 'select', { since: '3.39.0', evidence: 'runtime-version' }), lateral: sq('unsupported', 'select')
    },
    subqueries: {
      scalar: sq('native', 'select'), correlated: sq('native', 'select'), exists: sq('native', 'select'), in: sq('native', 'select'),
      anyAll: sq('partial', 'select', { notes: 'SQLite supports IN/EXISTS and scalar subqueries but not the full server-dialect ANY/ALL comparison syntax family.' }), derivedTables: sq('native', 'select')
    },
    cte: {
      ordinary: sq('native', 'with', { syntax: 'WITH' }), recursive: sq('native', 'with', { syntax: 'WITH RECURSIVE' }),
      materializationHints: sq('runtime-dependent', 'with', { since: '3.35.0', syntax: 'MATERIALIZED | NOT MATERIALIZED', evidence: 'runtime-version' }),
      search: sq('unsupported', 'with'), cycle: sq('unsupported', 'with')
    },
    setOperators: {
      union: sq('native', 'select'), unionAll: sq('native', 'select'), intersect: sq('native', 'select'), except: sq('native', 'select'),
      intersectAll: sq('unsupported', 'select'), exceptAll: sq('unsupported', 'select')
    },
    grouping: {
      groupBy: sq('native', 'select'), having: sq('native', 'select'), rollup: sq('unsupported', 'select'), cube: sq('unsupported', 'select'), groupingSets: sq('unsupported', 'select')
    },
    windows: {
      supported: sq('runtime-dependent', 'windows', { since: '3.25.0', evidence: 'runtime-probe' }),
      named: sq('runtime-dependent', 'windows', { since: '3.25.0', evidence: 'runtime-probe' }),
      rows: sq('runtime-dependent', 'windows', { since: '3.25.0', evidence: 'runtime-probe' }),
      range: sq('runtime-dependent', 'windows', { since: '3.25.0', evidence: 'runtime-probe' }),
      groups: sq('runtime-dependent', 'windows', { since: '3.28.0', evidence: 'runtime-probe' }),
      exclude: sq('runtime-dependent', 'windows', { evidence: 'runtime-probe' }), filter: sq('runtime-dependent', 'windows', { evidence: 'runtime-probe' })
    },
    distinct: { standard: sq('native', 'select'), on: sq('unsupported', 'select') },
    ordering: { orderBy: sq('native', 'select'), nullsFirstLast: sq('runtime-dependent', 'select', { since: '3.30.0', evidence: 'runtime-version' }) },
    pagination: { limit: sq('native', 'select'), offset: sq('native', 'select'), fetch: sq('unsupported', 'select') },
    locking: { forUpdate: sq('unsupported', 'transactions'), forShare: sq('unsupported', 'transactions'), nowait: sq('unsupported', 'transactions'), skipLocked: sq('unsupported', 'transactions') },
    tableSampling: { system: sq('unsupported', 'select'), bernoulli: sq('unsupported', 'select') }
  },

  schema: {
    table: sq('native', 'createTable'), temporaryTable: sq('native', 'createTable'), view: sq('native', 'language'), materializedView: sq('unsupported', 'language'),
    withoutRowidTable: sq('runtime-dependent', 'withoutRowid', { since: '3.8.2', evidence: 'runtime-version' }),
    strictTable: sq('runtime-dependent', 'strict', { since: '3.37.0', evidence: 'runtime-probe' }),
    virtualTable: sq('runtime-dependent', 'virtualTables', { evidence: 'runtime-compile-option' }),
    index: sq('native', 'createIndex'), uniqueIndex: sq('native', 'createIndex'), partialIndex: sq('runtime-dependent', 'partialIndex', { since: '3.8.0', evidence: 'runtime-version' }),
    expressionIndex: sq('runtime-dependent', 'exprIndex', { since: '3.9.0', evidence: 'runtime-version' }),
    sequence: sq('unsupported', 'createTable'), schema: sq('equivalent', 'attach', { nativeName: 'attached database namespace' }), database: sq('native', 'attach'),
    trigger: sq('native', 'language'), procedure: sq('unsupported', 'language'), storedFunction: sq('unsupported', 'language'),
    domain: sq('unsupported', 'datatype'), enum: sq('unsupported', 'datatype'), compositeType: sq('unsupported', 'datatype'), rangeType: sq('unsupported', 'datatype')
  },

  expressions: {
    arithmetic: sq('native', 'language'), comparison: sq('native', 'language'), boolean: sq('native', 'language'), threeValuedLogic: sq('native', 'language'),
    caseExpression: sq('native', 'language'), coalesce: sq('native', 'language'), ifNull: sq('native', 'language'), nullif: sq('native', 'language'), cast: sq('native', 'datatype'),
    collations: sq('native', 'datatype'), customCollations: sq('runtime-dependent', 'datatype', { evidence: 'host-runtime-capability' }), rowValues: sq('native', 'language'),
    json: sq('runtime-dependent', 'json', { nativeName: 'JSON functions', evidence: 'runtime-probe' }),
    jsonb: sq('runtime-dependent', 'json', { since: '3.45.0', evidence: 'runtime-probe' }), jsonPath: sq('runtime-dependent', 'json', { evidence: 'runtime-probe' }),
    arrays: sq('unsupported', 'datatype'), regex: sq('equivalent', 'language', { nativeName: 'REGEXP application function', notes: 'REGEXP syntax calls an application-defined regexp() function; regex implementation is not built into core SQLite.' }),
    glob: sq('native', 'language'), like: sq('native', 'language'), dateTime: sq('native', 'dateTime', { notes: 'Date/time values are represented using TEXT, REAL or INTEGER storage conventions rather than a dedicated datetime storage class.' }),
    aggregateFilter: sq('runtime-dependent', 'windows', { evidence: 'runtime-probe' })
  },

  integrity: {
    notNull: sq('native', 'createTable'), check: sq('native', 'createTable'), unique: sq('native', 'createTable'), primaryKey: sq('native', 'createTable'),
    foreignKey: sq('runtime-dependent', 'foreignKeys', { evidence: 'runtime-compile-and-connection-setting', restrictions: ['Foreign-key enforcement must be enabled for the connection.'] }),
    exclusion: sq('unsupported', 'createTable'), deferrableForeignKeys: sq('runtime-dependent', 'foreignKeys', { evidence: 'runtime-compile-and-connection-setting' }),
    deferAllForeignKeys: sq('runtime-dependent', 'pragma', { nativeName: 'PRAGMA defer_foreign_keys', evidence: 'runtime-probe' }),
    onDeleteCascade: sq('runtime-dependent', 'foreignKeys', { evidence: 'runtime-compile-and-connection-setting' }), onDeleteSetNull: sq('runtime-dependent', 'foreignKeys', { evidence: 'runtime-compile-and-connection-setting' }),
    onDeleteSetDefault: sq('runtime-dependent', 'foreignKeys', { evidence: 'runtime-compile-and-connection-setting' }), onDeleteRestrict: sq('runtime-dependent', 'foreignKeys', { evidence: 'runtime-compile-and-connection-setting' }),
    onUpdateCascade: sq('runtime-dependent', 'foreignKeys', { evidence: 'runtime-compile-and-connection-setting' }), onUpdateSetNull: sq('runtime-dependent', 'foreignKeys', { evidence: 'runtime-compile-and-connection-setting' }),
    generatedColumns: sq('runtime-dependent', 'generated', { since: '3.31.0', evidence: 'runtime-version' }), generatedVirtual: sq('runtime-dependent', 'generated', { since: '3.31.0', evidence: 'runtime-version' }),
    generatedStored: sq('runtime-dependent', 'generated', { since: '3.31.0', evidence: 'runtime-version' }),
    identity: sq('equivalent', 'createTable', { nativeName: 'INTEGER PRIMARY KEY / ROWID' }), autoIncrement: sq('equivalent', 'createTable', { nativeName: 'AUTOINCREMENT', notes: 'AUTOINCREMENT changes ROWID allocation semantics and is not SQL-standard identity.' })
  },

  physical: {
    partitioning: sq('unsupported', 'createTable'), tablespaces: sq('not-applicable', 'createTable'), storageEngines: sq('not-applicable', 'createTable'), clustering: sq('unsupported', 'createIndex'),
    rowidStorage: sq('native', 'createTable'), withoutRowidStorage: sq('runtime-dependent', 'withoutRowid', { since: '3.8.2', evidence: 'runtime-version' }),
    btreeIndexes: sq('native', 'createIndex'), journalModes: sq('native', 'pragma'), wal: sq('native', 'wal'), rollbackJournal: sq('native', 'locking'),
    synchronousPolicy: sq('native', 'pragma'), lockingMode: sq('native', 'pragma'), busyTimeout: sq('native', 'pragma'), cacheSize: sq('native', 'pragma'), mmapSize: sq('native', 'pragma'),
    pageSize: sq('native', 'pragma'), maxPageCount: sq('native', 'pragma'), autoVacuum: sq('native', 'pragma'), tempStore: sq('native', 'pragma')
  },

  security: {
    usersAndRoles: sq('not-applicable', 'language'), accounts: sq('not-applicable', 'language'), grants: sq('not-applicable', 'language'), revokes: sq('not-applicable', 'language'),
    ownership: sq('not-applicable', 'language'), rowLevelSecurity: sq('unsupported', 'language'), securityDefiner: sq('not-applicable', 'language'),
    authorizer: sq('runtime-dependent', 'language', { evidence: 'node-runtime-capability', nativeName: 'sqlite3_set_authorizer / host binding' }),
    defensiveMode: sq('runtime-dependent', 'pragma', { evidence: 'node-runtime-capability' }),
    queryOnly: sq('native', 'pragma', { nativeName: 'PRAGMA query_only' }),
    extensionLoadingPolicy: sq('runtime-dependent', 'loadExtension', { evidence: 'host-runtime-capability' })
  },

  transactions: {
    transactions: sq('native', 'transactions'), autocommit: sq('native', 'transactions'), savepoints: sq('native', 'transactions'), nestedTransactions: sq('emulated', 'transactions', { nativeName: 'savepoints' }),
    deferred: sq('native', 'transactions', { syntax: 'BEGIN DEFERRED' }), immediate: sq('native', 'transactions', { syntax: 'BEGIN IMMEDIATE' }), exclusive: sq('native', 'transactions', { syntax: 'BEGIN EXCLUSIVE' }),
    readOnly: sq('partial', 'pragma', { notes: 'Read-only behavior is connection/file/query policy rather than a SQL read-only transaction characteristic.' }),
    serializable: sq('partial', 'transactions', { notes: 'SQLite serializes writes and provides serializable transactions except where explicit shared-cache read-uncommitted behavior is enabled.' }),
    readUncommitted: sq('partial', 'pragma', { nativeName: 'PRAGMA read_uncommitted', restrictions: ['Meaningful dirty-read behavior requires shared-cache connections.'] }),
    rowLocks: sq('unsupported', 'locking'), tableLocks: sq('unsupported', 'locking'), databaseFileLocks: sq('native', 'locking'), oneWriter: sq('native', 'locking'),
    walReaderWriterConcurrency: sq('native', 'wal'), advisoryLocks: sq('unsupported', 'locking'), nowait: sq('unsupported', 'transactions'), skipLocked: sq('unsupported', 'transactions'), autonomousTransactions: sq('unsupported', 'transactions')
  },

  programmability: {
    procedures: sq('unsupported', 'language'), storedFunctions: sq('unsupported', 'language'), anonymousBlocks: sq('unsupported', 'language'), packages: sq('unsupported', 'language'),
    triggers: sq('native', 'language'), recursiveTriggers: sq('runtime-dependent', 'pragma', { evidence: 'runtime-setting' }),
    scalarFunctions: sq('equivalent', 'language', { nativeName: 'application-defined scalar functions' }),
    aggregateFunctions: sq('equivalent', 'language', { nativeName: 'application-defined aggregate functions' }),
    windowFunctions: sq('runtime-dependent', 'windows', { nativeName: 'application-defined window functions', evidence: 'host-runtime-capability' }),
    dynamicSql: sq('not-applicable', 'language', { notes: 'Dynamic SQL is performed by the host application; SQLite has no stored procedural language.' })
  },

  administration: {
    explain: sq('native', 'explain'), explainQueryPlan: sq('native', 'explain'), explainAnalyze: sq('unsupported', 'explain'), analyze: sq('native', 'analyze'),
    vacuum: sq('native', 'vacuum'), vacuumInto: sq('native', 'vacuum'), incrementalVacuum: sq('native', 'pragma'), optimize: sq('native', 'pragma', { nativeName: 'PRAGMA optimize' }),
    integrityCheck: sq('native', 'pragma'), quickCheck: sq('native', 'pragma'), foreignKeyCheck: sq('runtime-dependent', 'pragma', { evidence: 'runtime-compile-option' }),
    walCheckpoint: sq('native', 'pragma'), sessionSettings: sq('equivalent', 'pragma', { nativeName: 'PRAGMA' }),
    compileOptions: sq('native', 'pragma', { nativeName: 'PRAGMA compile_options' }), moduleList: sq('native', 'pragma', { nativeName: 'PRAGMA module_list' }),
    queryHints: sq('partial', 'select', { notes: 'SQLite exposes INDEXED BY, NOT INDEXED and planner controls, not a general optimizer-hint syntax.' })
  },

  dataMovement: {
    bulkLoad: sq('unsupported', 'language', { notes: 'Core SQL has no COPY/LOAD DATA command.' }), bulkExport: sq('unsupported', 'language'),
    attachDatabase: sq('native', 'attach'), detachDatabase: sq('native', 'attach'),
    onlineBackup: sq('runtime-dependent', 'language', { evidence: 'host-runtime-capability', nativeName: 'SQLite backup API' }),
    serializeDeserialize: sq('runtime-dependent', 'language', { evidence: 'host-runtime-capability' }),
    changesets: sq('runtime-dependent', 'session', { evidence: 'host-runtime-capability' }), patchsets: sq('runtime-dependent', 'session', { evidence: 'host-runtime-capability' }),
    applyChangeset: sq('runtime-dependent', 'session', { evidence: 'host-runtime-capability' }), federatedQueries: sq('unsupported', 'attach', { notes: 'ATTACH combines SQLite database files; it is not a remote federation mechanism.' })
  },

  extensions: {
    loadableExtensions: sq('runtime-dependent', 'loadExtension', { evidence: 'host-runtime-capability' }), virtualTables: sq('native', 'virtualTables'),
    fts5: sq('runtime-dependent', 'fts5', { evidence: 'runtime-compile-option' }), rtree: sq('runtime-dependent', 'rtree', { evidence: 'runtime-compile-option' }),
    jsonFunctions: sq('runtime-dependent', 'json', { evidence: 'runtime-probe' }), sessionExtension: sq('runtime-dependent', 'session', { evidence: 'runtime-compile-and-host-capability' }),
    applicationDefinedFunctions: sq('native', 'language'), applicationDefinedCollations: sq('native', 'datatype')
  },

  types: {
    nullStorage: sq('native', 'datatype'), integerStorage: sq('native', 'datatype'), realStorage: sq('native', 'datatype'), textStorage: sq('native', 'datatype'), blobStorage: sq('native', 'datatype'),
    integerAffinity: sq('native', 'datatype'), realAffinity: sq('native', 'datatype'), textAffinity: sq('native', 'datatype'), numericAffinity: sq('native', 'datatype'), blobAffinity: sq('native', 'datatype'),
    dynamicTyping: sq('native', 'datatype'), strictTables: sq('runtime-dependent', 'strict', { since: '3.37.0', evidence: 'runtime-probe' }),
    strictInt: sq('runtime-dependent', 'strict', { since: '3.37.0', evidence: 'runtime-probe' }), strictInteger: sq('runtime-dependent', 'strict', { since: '3.37.0', evidence: 'runtime-probe' }),
    strictReal: sq('runtime-dependent', 'strict', { since: '3.37.0', evidence: 'runtime-probe' }), strictText: sq('runtime-dependent', 'strict', { since: '3.37.0', evidence: 'runtime-probe' }),
    strictBlob: sq('runtime-dependent', 'strict', { since: '3.37.0', evidence: 'runtime-probe' }), strictAny: sq('runtime-dependent', 'strict', { since: '3.37.0', evidence: 'runtime-probe' }),
    boolean: sq('equivalent', 'datatype', { nativeName: 'INTEGER 0/1 convention' }), dateTime: sq('equivalent', 'dateTime', { nativeName: 'TEXT/REAL/INTEGER convention' }),
    json: sq('equivalent', 'json', { notes: 'JSON uses TEXT or JSONB BLOB representation rather than a dedicated declared storage type.' }),
    arrays: sq('unsupported', 'datatype'), uuid: sq('equivalent', 'datatype', { notes: 'UUID values are application conventions over TEXT or BLOB.' }), enum: sq('unsupported', 'datatype'), domain: sq('unsupported', 'datatype')
  },

  functions: {
    scalarBuiltins: sq('native', 'language'), aggregateBuiltins: sq('native', 'language'), windowBuiltins: sq('runtime-dependent', 'windows', { evidence: 'runtime-version' }),
    scalarUserDefined: sq('equivalent', 'language', { nativeName: 'application-defined functions' }), aggregateUserDefined: sq('equivalent', 'language', { nativeName: 'application-defined aggregate functions' }),
    windowUserDefined: sq('runtime-dependent', 'windows', { evidence: 'host-runtime-capability' }), jsonFunctions: sq('runtime-dependent', 'json', { evidence: 'runtime-probe' }), dateTimeFunctions: sq('native', 'dateTime'),
    tableValuedPragmas: sq('native', 'pragma'), tableFunctions: sq('partial', 'virtualTables', { notes: 'Eponymous virtual tables and selected extensions provide table-valued behavior.' })
  },

  operators: {
    arithmetic: sq('native', 'language'), comparison: sq('native', 'language'), logical: sq('native', 'language'), concatenation: sq('native', 'language'),
    jsonOperators: sq('runtime-dependent', 'json', { since: '3.38.0', evidence: 'runtime-probe', aliases: ['->', '->>'] }),
    glob: sq('native', 'language'), regexp: sq('equivalent', 'language', { nativeName: 'regexp() application function' }), match: sq('partial', 'fts5', { notes: 'MATCH semantics depend on the table/module implementing it.' }),
    userDefinedOperators: sq('unsupported', 'language')
  },

  keywords: {
    catalogued: sq('partial', 'language', { notes: 'SQLite exposes keyword inspection through the C API rather than a relational SQL keyword catalog.' }),
    quotingTolerance: sq('native', 'language', { notes: 'SQLite accepts standard identifier quoting plus compatibility forms; applications should use standard quoting.' })
  },

  syntax: {
    returning: sq('runtime-dependent', 'returning', { since: '3.35.0', syntax: 'RETURNING', evidence: 'runtime-probe' }),
    conflictHandling: sq('native', 'upsert', { nativeName: 'ON CONFLICT / UPSERT' }), upsert: sq('native', 'upsert'),
    conflictAlgorithms: sq('native', 'conflict', { syntax: 'ROLLBACK | ABORT | FAIL | IGNORE | REPLACE' }),
    insertOrReplace: sq('native', 'conflict'), replace: sq('native', 'insert'), indexedBy: sq('native', 'select', { syntax: 'INDEXED BY' }), notIndexed: sq('native', 'select', { syntax: 'NOT INDEXED' }),
    materializedCteHint: sq('runtime-dependent', 'with', { since: '3.35.0', evidence: 'runtime-version' }), withoutRowid: sq('runtime-dependent', 'withoutRowid', { since: '3.8.2', evidence: 'runtime-version' }),
    strict: sq('runtime-dependent', 'strict', { since: '3.37.0', evidence: 'runtime-probe' })
  },

  limits: {
    implementationLimits: sq('native', 'limits'), runtimeLowerableLimits: sq('runtime-dependent', 'limits', { evidence: 'host-runtime-capability' }),
    sqlLength: sq('runtime-dependent', 'limits', { evidence: 'host-runtime-capability' }), valueLength: sq('runtime-dependent', 'limits', { evidence: 'host-runtime-capability' }),
    columnCount: sq('runtime-dependent', 'limits', { evidence: 'host-runtime-capability' }), expressionDepth: sq('runtime-dependent', 'limits', { evidence: 'host-runtime-capability' }),
    compoundSelectTerms: sq('runtime-dependent', 'limits', { evidence: 'host-runtime-capability' }), variableNumber: sq('runtime-dependent', 'limits', { evidence: 'host-runtime-capability' }),
    triggerDepth: sq('runtime-dependent', 'limits', { evidence: 'host-runtime-capability' }), attachedDatabases: sq('native', 'limits', { notes: 'Default compile-time maximum is finite and may be lowered per connection.' }),
    maxPageCount: sq('native', 'pragma'), resourceGovernance: sq('equivalent', 'limits', { nativeName: 'NuBloxSQL resource governance', notes: 'NuBloxSQL combines native SQLite limits where exposed with result and page-count budgets.' }),
    runtimeQueryable: sq('runtime-dependent', 'limits', { evidence: 'node-runtime-capability' })
  }
}, {
  coverage: 'exhaustive-v1',
  evidenceRegister: Object.keys(R).map(function (key) { return R[key]; })
});
