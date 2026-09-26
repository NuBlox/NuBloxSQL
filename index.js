var Classes = Object.create(null);

/**
 * Create a new Connection instance.
 * @param {object|string} config Configuration or connection string for new MySQL connection
 * @return {Connection} A new MySQL connection
 * @public
 */
exports.createConnection = function createConnection(config) {
  var Connection       = loadClass('Connection');
  var ConnectionConfig = loadClass('ConnectionConfig');
  var connection       = new Connection({config: new ConnectionConfig(config)});

  return decorateConnection(connection, getPromiseImplementation(config));
};

/**
 * Create a new Pool instance.
 * @param {object|string} config Configuration or connection string for new MySQL connections
 * @return {Pool} A new MySQL pool
 * @public
 */
exports.createPool = function createPool(config) {
  var Pool       = loadClass('Pool');
  var PoolConfig = loadClass('PoolConfig');
  var pool       = new Pool({config: new PoolConfig(config)});

  return decoratePool(pool, getPromiseImplementation(config));
};

/**
 * Create a new PoolCluster instance.
 * @param {object} [config] Configuration for pool cluster
 * @return {PoolCluster} New MySQL pool cluster
 * @public
 */
exports.createPoolCluster = function createPoolCluster(config) {
  var PoolCluster = loadClass('PoolCluster');

  return new PoolCluster(config);
};

/**
 * Create a new Query instance.
 * @param {string} sql The SQL for the query
 * @param {array} [values] Any values to insert into placeholders in sql
 * @param {function} [callback] The callback to use when query is complete
 * @return {Query} New query object
 * @public
 */
exports.createQuery = function createQuery(sql, values, callback) {
  var Connection = loadClass('Connection');

  return Connection.createQuery(sql, values, callback);
};

/**
 * Escape a value for SQL.
 * @param {*} value The value to escape
 * @param {boolean} [stringifyObjects=false] Setting if objects should be stringified
 * @param {string} [timeZone=local] Setting for time zone to use for Date conversion
 * @return {string} Escaped string value
 * @public
 */
exports.escape = function escape(value, stringifyObjects, timeZone) {
  var SqlString = loadClass('SqlString');

  return SqlString.escape(value, stringifyObjects, timeZone);
};

/**
 * Escape an identifier for SQL.
 * @param {*} value The value to escape
 * @param {boolean} [forbidQualified=false] Setting to treat '.' as part of identifier
 * @return {string} Escaped string value
 * @public
 */
exports.escapeId = function escapeId(value, forbidQualified) {
  var SqlString = loadClass('SqlString');

  return SqlString.escapeId(value, forbidQualified);
};

/**
 * Format SQL and replacement values into a SQL string.
 * @param {string} sql The SQL for the query
 * @param {array} [values] Any values to insert into placeholders in sql
 * @param {boolean} [stringifyObjects=false] Setting if objects should be stringified
 * @param {string} [timeZone=local] Setting for time zone to use for Date conversion
 * @return {string} Formatted SQL string
 * @public
 */
exports.format = function format(sql, values, stringifyObjects, timeZone) {
  var SqlString = loadClass('SqlString');

  return SqlString.format(sql, values, stringifyObjects, timeZone);
};

/**
 * Wrap raw SQL strings from escape overriding.
 * @param {string} sql The raw SQL
 * @return {object} Wrapped object
 * @public
 */
exports.raw = function raw(sql) {
  var SqlString = loadClass('SqlString');

  return SqlString.raw(sql);
};

/**
 * The type constants.
 * @public
 */
Object.defineProperty(exports, 'Types', {
  get: loadClass.bind(null, 'Types')
});

/**
 * Promise connection wrapper constructor.
 * @public
 */
Object.defineProperty(exports, 'PromiseConnection', {
  get: loadClass.bind(null, 'PromiseConnection')
});

/**
 * Promise pool wrapper constructor.
 * @public
 */
Object.defineProperty(exports, 'PromisePool', {
  get: loadClass.bind(null, 'PromisePool')
});

function decorateConnection(connection, PromiseImpl) {
  if (typeof connection.promise !== 'function') {
    Object.defineProperty(connection, 'promise', {
      configurable : true,
      enumerable   : false,
      value        : function promise(overridePromise) {
        var PromiseConnection = loadClass('PromiseConnection');

        return new PromiseConnection(connection, overridePromise || PromiseImpl || global.Promise);
      }
    });
  }

  return connection;
}

function decoratePool(pool, PromiseImpl) {
  if (typeof pool.promise !== 'function') {
    Object.defineProperty(pool, 'promise', {
      configurable : true,
      enumerable   : false,
      value        : function promise(overridePromise) {
        var PromisePool = loadClass('PromisePool');

        return new PromisePool(pool, overridePromise || PromiseImpl || global.Promise);
      }
    });
  }

  return pool;
}

function getPromiseImplementation(config) {
  if (config && typeof config === 'object' && typeof config.Promise === 'function') {
    return config.Promise;
  }

  return global.Promise;
}

/**
 * Load the given class.
 * @param {string} className Name of class to default
 * @return {function|object} Class constructor or exports
 * @private
 */
function loadClass(className) {
  var Class = Classes[className];

  if (Class !== undefined) {
    return Class;
  }

  // This uses a switch for static require analysis
  switch (className) {
    case 'Connection':
      Class = require('./lib/Connection');
      break;
    case 'ConnectionConfig':
      Class = require('./lib/ConnectionConfig');
      break;
    case 'Pool':
      Class = require('./lib/Pool');
      break;
    case 'PoolCluster':
      Class = require('./lib/PoolCluster');
      break;
    case 'PoolConfig':
      Class = require('./lib/PoolConfig');
      break;
    case 'PromiseConnection':
      Class = require('./lib/PromiseConnection');
      break;
    case 'PromisePool':
      Class = require('./lib/PromisePool');
      break;
    case 'SqlString':
      Class = require('./lib/protocol/SqlString');
      break;
    case 'Types':
      Class = require('./lib/protocol/constants/types');
      break;
    default:
      throw new Error('Cannot find class \' ' + className + '\'');
  }

  // Store to prevent invoking require()
  Classes[className] = Class;

  return Class;
}
