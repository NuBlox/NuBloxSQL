'use strict';

var Query = require('./protocol/sequences/Query');
var convert = null;

exports.decorateConnection = decorateConnection;
exports.decoratePool = decoratePool;
exports.resolve = resolve;

function decorateConnection(connection) {
  if (connection._nubloxNamedPlaceholdersWrapped) {
    return connection;
  }

  var originalQuery = connection.query;
  var originalExecute = connection.execute;

  defineMethod(connection, 'query', function query(sql, values, callback) {
    if (!shouldResolve(this.config, sql, values)) {
      return originalQuery.apply(this, arguments);
    }

    var args = normalizeArgs(sql, values, callback);

    if (args.query) {
      resolve(this.config, args.query);
      return originalQuery.call(this, args.query);
    }

    resolve(this.config, args.options);
    return originalQuery.call(this, args.options, args.callback);
  });

  if (typeof originalExecute === 'function') {
    defineMethod(connection, 'execute', function execute(sql, values, callback) {
      if (!shouldResolve(this.config, sql, values)) {
        return originalExecute.apply(this, arguments);
      }

      var args = normalizeArgs(sql, values, callback);

      resolve(this.config, args.options);
      return originalExecute.call(this, args.options, args.callback);
    });
  }

  Object.defineProperty(connection, '_nubloxNamedPlaceholdersWrapped', {
    configurable : true,
    enumerable   : false,
    value        : true,
    writable     : false
  });

  return connection;
}

function decoratePool(pool) {
  if (pool._nubloxNamedPlaceholdersWrapped) {
    return pool;
  }

  var originalGetConnection = pool.getConnection;
  var originalExecute = pool.execute;

  defineMethod(pool, 'getConnection', function getConnection(callback) {
    return originalGetConnection.call(this, function onConnection(error, connection) {
      if (connection) {
        decorateConnection(connection);
      }
      callback(error, connection);
    });
  });

  if (typeof originalExecute === 'function') {
    defineMethod(pool, 'execute', function execute(sql, values, callback) {
      if (!shouldResolve(this.config.connectionConfig, sql, values)) {
        return originalExecute.apply(this, arguments);
      }

      var args = normalizeArgs(sql, values, callback);

      resolve(this.config.connectionConfig, args.options);
      return originalExecute.call(this, args.options, args.callback);
    });
  }

  Object.defineProperty(pool, '_nubloxNamedPlaceholdersWrapped', {
    configurable : true,
    enumerable   : false,
    value        : true,
    writable     : false
  });

  return pool;
}

function defineMethod(target, name, method) {
  var ownDescriptor = Object.getOwnPropertyDescriptor(target, name);
  var descriptor = ownDescriptor || {
    configurable : true,
    enumerable   : false,
    writable     : true
  };

  if (descriptor.configurable === false) {
    throw new TypeError('Cannot decorate non-configurable method ' + name);
  }

  Object.defineProperty(target, name, {
    configurable : descriptor.configurable !== false,
    enumerable   : descriptor.enumerable === true,
    value        : method,
    writable     : descriptor.writable !== false
  });
}

function shouldResolve(config, sql, values) {
  var enabled = config && config.namedPlaceholders;
  var resolvedValues = values;

  if (sql instanceof Query || (typeof sql === 'object' && sql !== null)) {
    if (sql.namedPlaceholders !== undefined) {
      enabled = sql.namedPlaceholders;
    }

    if (values === undefined || typeof values === 'function') {
      resolvedValues = sql.values;
    }
  }

  return enabled === true && !Array.isArray(resolvedValues);
}

function normalizeArgs(sql, values, callback) {
  if (sql instanceof Query) {
    return {query: sql};
  }

  var cb = callback;
  var options;

  if (typeof sql === 'object' && sql !== null) {
    options = Object.create(sql);

    if (typeof values === 'function') {
      cb = values;
    } else if (values !== undefined) {
      Object.defineProperty(options, 'values', {value: values});
    }
  } else {
    options = {sql: sql};

    if (typeof values === 'function') {
      cb = values;
    } else if (values !== undefined) {
      options.values = values;
    }
  }

  return {
    options  : options,
    callback : cb
  };
}

function resolve(config, options) {
  if (options.namedPlaceholders === undefined) {
    options.namedPlaceholders = config && config.namedPlaceholders === true;
  }

  if (!options.namedPlaceholders || Array.isArray(options.values)) {
    return options;
  }

  if (convert === null) {
    convert = require('named-placeholders')();
  }

  var unnamed = convert(options.sql, options.values);

  options.sql = unnamed[0];
  options.values = unnamed[1];
  return options;
}
