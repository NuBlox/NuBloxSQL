'use strict';

var DIALECT_FAMILIES = Object.freeze({
  MYSQL       : 'mysql',
  MARIADB     : 'mariadb',
  POSTGRESQL  : 'postgresql',
  COCKROACHDB : 'cockroachdb',
  SQLITE      : 'sqlite',
  DUCKDB      : 'duckdb',
  SQLSERVER   : 'sqlserver',
  ORACLE      : 'oracle',
  DB2         : 'db2',
  SNOWFLAKE   : 'snowflake',
  REDSHIFT    : 'redshift',
  BIGQUERY    : 'bigquery',
  CLICKHOUSE  : 'clickhouse'
});

var CAPABILITY_LEVELS = Object.freeze({
  NATIVE      : 'native',
  EMULATED    : 'emulated',
  CONDITIONAL : 'conditional',
  UNSUPPORTED : 'unsupported',
  UNKNOWN     : 'unknown'
});

var CAPABILITIES = Object.freeze({
  CONNECTION_POOLING       : 'connectionPooling',
  TLS                      : 'tls',
  MUTUAL_TLS               : 'mutualTls',
  PREPARED_STATEMENTS      : 'preparedStatements',
  SERVER_PREPARED          : 'serverPreparedStatements',
  NAMED_PARAMETERS         : 'namedParameters',
  POSITIONAL_PARAMETERS    : 'positionalParameters',
  BINARY_PROTOCOL          : 'binaryProtocol',
  SERVER_SIDE_CURSORS      : 'serverSideCursors',
  STREAMING_RESULTS        : 'streamingResults',
  QUERY_CANCELLATION       : 'queryCancellation',
  QUERY_TIMEOUT            : 'queryTimeout',
  MULTI_STATEMENT          : 'multiStatement',
  MULTI_RESULT             : 'multiResult',
  MULTIPLE_ACTIVE_RESULTS  : 'multipleActiveResults',
  SAVEPOINTS               : 'savepoints',
  TRANSACTION_ISOLATION    : 'transactionIsolation',
  READ_ONLY_TRANSACTIONS   : 'readOnlyTransactions',
  TWO_PHASE_COMMIT         : 'twoPhaseCommit',
  TRANSACTIONAL_DDL        : 'transactionalDdl',
  CATALOGS                 : 'catalogs',
  SCHEMAS                  : 'schemas',
  GENERATED_KEYS           : 'generatedKeys',
  RETURNING                : 'returning',
  UPSERT                   : 'upsert',
  MERGE                    : 'merge',
  CTE                      : 'cte',
  RECURSIVE_CTE            : 'recursiveCte',
  WINDOW_FUNCTIONS         : 'windowFunctions',
  NATIVE_JSON              : 'nativeJson',
  ARRAYS                   : 'arrays',
  UUID                     : 'uuid',
  SPATIAL                  : 'spatial',
  FULL_TEXT_SEARCH         : 'fullTextSearch',
  BULK_LOAD                : 'bulkLoad',
  COPY_PROTOCOL            : 'copyProtocol',
  CHANGE_DATA_CAPTURE      : 'changeDataCapture',
  NOTIFICATIONS            : 'notifications',
  SESSION_STATE            : 'sessionState',
  ROLE_SWITCHING           : 'roleSwitching',
  ADVISORY_LOCKS           : 'advisoryLocks',
  STORED_PROCEDURES        : 'storedProcedures',
  STORED_FUNCTIONS         : 'storedFunctions',
  SEQUENCES                : 'sequences',
  IDENTITY_COLUMNS         : 'identityColumns',
  PARTITIONING             : 'partitioning',
  MATERIALIZED_VIEWS       : 'materializedViews',
  EXTENSIONS               : 'extensions',
  EXPLAIN                  : 'explain',
  EXPLAIN_ANALYZE          : 'explainAnalyze'
});

var CAPABILITY_LEVEL_SET = Object.freeze(Object.keys(CAPABILITY_LEVELS).reduce(function buildSet(set, key) {
  set[CAPABILITY_LEVELS[key]] = true;
  return set;
}, Object.create(null)));

function copyBooleanMap(input) {
  var output = Object.create(null);
  var source = input || {};

  Object.keys(source).forEach(function copyCapability(key) {
    if (typeof source[key] !== 'boolean') {
      throw new TypeError('SQL capability values must be boolean');
    }
    output[key] = source[key];
  });

  return Object.freeze(output);
}

function normalizeCapabilityEntry(name, entry) {
  if (typeof entry === 'boolean') {
    return Object.freeze({
      name: name,
      level: entry ? CAPABILITY_LEVELS.NATIVE : CAPABILITY_LEVELS.UNSUPPORTED
    });
  }

  if (!entry || typeof entry !== 'object') {
    throw new TypeError('SQL capability profile entry must be a boolean or object');
  }

  var level = entry.level || CAPABILITY_LEVELS.UNKNOWN;
  if (!CAPABILITY_LEVEL_SET[level]) {
    throw new TypeError('Invalid SQL capability level: ' + level);
  }

  if (entry.since !== undefined && typeof entry.since !== 'string') {
    throw new TypeError('SQL capability since must be a string');
  }
  if (entry.until !== undefined && typeof entry.until !== 'string') {
    throw new TypeError('SQL capability until must be a string');
  }
  if (entry.requires !== undefined && !Array.isArray(entry.requires)) {
    throw new TypeError('SQL capability requires must be an array');
  }

  return Object.freeze({
    name: name,
    level: level,
    since: entry.since,
    until: entry.until,
    requires: entry.requires ? Object.freeze(entry.requires.slice()) : undefined,
    notes: entry.notes,
    extension: entry.extension
  });
}

function createCapabilityProfile(input) {
  var source = input || {};
  if (!source || typeof source !== 'object' || Array.isArray(source)) {
    throw new TypeError('SQL capability profile must be an object');
  }

  var profile = Object.create(null);
  Object.keys(source).forEach(function normalizeEntry(name) {
    profile[name] = normalizeCapabilityEntry(name, source[name]);
  });
  return Object.freeze(profile);
}

function capabilityProfileToBooleanMap(profile) {
  var source = profile || {};
  var output = Object.create(null);
  Object.keys(source).forEach(function projectCapability(name) {
    var level = source[name].level;
    output[name] = level === CAPABILITY_LEVELS.NATIVE || level === CAPABILITY_LEVELS.EMULATED || level === CAPABILITY_LEVELS.CONDITIONAL;
  });
  return Object.freeze(output);
}

function normalizeIdentity(identity) {
  if (!identity || typeof identity !== 'object') {
    throw new TypeError('SQL dialect identity must be an object');
  }

  if (typeof identity.family !== 'string' || identity.family.length === 0) {
    throw new TypeError('SQL dialect identity family must be a non-empty string');
  }

  if (typeof identity.name !== 'string' || identity.name.length === 0) {
    throw new TypeError('SQL dialect identity name must be a non-empty string');
  }

  return Object.freeze({
    family          : identity.family,
    name            : identity.name,
    serverVersion   : identity.serverVersion,
    protocolVersion : identity.protocolVersion,
    edition         : identity.edition,
    distribution    : identity.distribution
  });
}

function assertDialectServices(services) {
  if (!services || typeof services !== 'object') {
    throw new TypeError('SQL dialect services must be an object');
  }

  if (typeof services.quoteIdentifier !== 'function') {
    throw new TypeError('SQL dialect services require quoteIdentifier()');
  }

  if (typeof services.placeholder !== 'function') {
    throw new TypeError('SQL dialect services require placeholder()');
  }

  return services;
}

function createDialectDescriptor(options) {
  if (!options || typeof options !== 'object') {
    throw new TypeError('SQL dialect descriptor options must be an object');
  }

  var identity = normalizeIdentity(options.identity);
  var profile = options.capabilityProfile ? createCapabilityProfile(options.capabilityProfile) : null;
  var capabilities = profile ? capabilityProfileToBooleanMap(profile) : copyBooleanMap(options.capabilities);
  var services = assertDialectServices(options.services);

  var descriptor = {
    identity          : identity,
    capabilities      : capabilities,
    capabilityProfile : profile,
    services          : services,
    supports          : function supports(capability) {
      return capabilities[capability] === true;
    },
    capability        : function capability(name) {
      if (profile && profile[name]) return profile[name];
      if (Object.prototype.hasOwnProperty.call(capabilities, name)) {
        return normalizeCapabilityEntry(name, capabilities[name]);
      }
      return Object.freeze({name: name, level: CAPABILITY_LEVELS.UNKNOWN});
    }
  };

  return Object.freeze(descriptor);
}

function assertDialectDescriptor(descriptor) {
  if (!descriptor || typeof descriptor !== 'object') {
    throw new TypeError('SQL dialect descriptor must be an object');
  }

  normalizeIdentity(descriptor.identity);
  copyBooleanMap(descriptor.capabilities);
  if (descriptor.capabilityProfile) createCapabilityProfile(descriptor.capabilityProfile);
  assertDialectServices(descriptor.services);

  if (typeof descriptor.supports !== 'function') {
    throw new TypeError('SQL dialect descriptor requires supports()');
  }

  return descriptor;
}

function createObjectName(name) {
  if (!name || typeof name !== 'object') {
    throw new TypeError('SQL object name must be an object');
  }

  if (typeof name.name !== 'string' || name.name.length === 0) {
    throw new TypeError('SQL object name requires a non-empty name');
  }

  return Object.freeze({
    catalog : name.catalog,
    schema  : name.schema,
    name    : name.name
  });
}

exports.DIALECT_FAMILIES = DIALECT_FAMILIES;
exports.CAPABILITY_LEVELS = CAPABILITY_LEVELS;
exports.CAPABILITIES = CAPABILITIES;
exports.createCapabilityProfile = createCapabilityProfile;
exports.capabilityProfileToBooleanMap = capabilityProfileToBooleanMap;
exports.createDialectDescriptor = createDialectDescriptor;
exports.assertDialectDescriptor = assertDialectDescriptor;
exports.createObjectName = createObjectName;
