'use strict';

var Query = require('./protocol/sequences/Query');
var convert = null;

exports.decorateConnection = decorateConnection;
exports.resolve = resolve;

function decorateConnection(connection) {
  if (connection._nubloxNamedPlaceholdersWrapped) {
    return connection;
  }

  var originalQuery = connection.query;

  connection.query = function query(sql, values, callback) {
    var cb = callback;
    var options;

    if (sql instanceof Query) {
      resolve(this.config, sql);
      return originalQuery.call(this, sql);
    }

    if (typeof sql === 'object' && sql !== null) {
      options = Object.create(sql);

      if (typeof values === 'function') {
        cb = values;
      } else if (values !== undefined) {
        Object.defineProperty(options, 'values', {value: values});
      }

      resolve(this.config, options);
      return originalQuery.call(this, options, cb);
    }

    options = {sql: sql};

    if (typeof values === 'function') {
      cb = values;
    } else if (values !== undefined) {
      options.values = values;
    }

    resolve(this.config, options);
    return originalQuery.call(this, options.sql, options.values, cb);
  };

  Object.defineProperty(connection, '_nubloxNamedPlaceholdersWrapped', {
    configurable : true,
    enumerable   : false,
    value        : true,
    writable     : false
  });

  return connection;
}

function resolve(config, options) {
  if (options.namedPlaceholders === undefined) {
    options.namedPlaceholders = config.namedPlaceholders;
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
