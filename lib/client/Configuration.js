'use strict';

var publicError = require('./PublicError');

function configError(message, Type, dialect, cause) {
  return publicError.configurationError(message, dialect, cause);
}

function requireObject(config, label, dialect) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw configError((label || 'configuration') + ' must be an options object', TypeError, dialect);
  }
  return config;
}

function optionalString(config, name, options, dialect) {
  if (config[name] === undefined) return;
  options = options || {};
  if (typeof config[name] !== 'string') throw configError(name + ' must be a string', TypeError, dialect);
  if (options.nonEmpty && config[name].trim().length === 0) throw configError(name + ' must not be empty', TypeError, dialect);
}

function optionalBoolean(config, name, dialect) {
  if (config[name] !== undefined && typeof config[name] !== 'boolean') {
    throw configError(name + ' must be a boolean', TypeError, dialect);
  }
}

function optionalInteger(config, name, options, dialect) {
  if (config[name] === undefined) return;
  options = options || {};
  var value = config[name];
  if (!Number.isInteger(value)) throw configError(name + ' must be an integer', RangeError, dialect);
  if (options.min !== undefined && value < options.min) {
    throw configError(name + ' must be at least ' + options.min, RangeError, dialect);
  }
  if (options.max !== undefined && value > options.max) {
    throw configError(name + ' must be at most ' + options.max, RangeError, dialect);
  }
}

function validateConnectionConfig(dialect, config) {
  requireObject(config, 'connection configuration', dialect);

  if (dialect !== 'sqlite') {
    optionalString(config, 'host', { nonEmpty: true }, dialect);
    optionalInteger(config, 'port', { min: 1, max: 65535 }, dialect);
    optionalString(config, 'user', { nonEmpty: true }, dialect);
    optionalString(config, 'password', null, dialect);
    optionalString(config, 'database', null, dialect);
  }

  optionalInteger(config, 'connectTimeout', { min: 0 }, dialect);
  return config;
}

function validatePoolOptions(config, dialect) {
  requireObject(config, 'pool configuration', dialect);
  optionalInteger(config, 'connectionLimit', { min: 1 }, dialect);
  optionalInteger(config, 'maxIdle', { min: 1 }, dialect);
  optionalInteger(config, 'idleTimeout', { min: 0 }, dialect);
  optionalInteger(config, 'acquireTimeout', { min: 1 }, dialect);
  optionalInteger(config, 'queueLimit', { min: 0 }, dialect);
  optionalBoolean(config, 'resetOnRelease', dialect);

  if (config.connectionLimit !== undefined && config.maxIdle !== undefined && config.maxIdle > config.connectionLimit) {
    throw configError('maxIdle must not exceed connectionLimit', RangeError, dialect);
  }

  return config;
}

function validatePoolConfig(dialect, config) {
  validateConnectionConfig(dialect, config);
  validatePoolOptions(config, dialect);
  return config;
}

function validateClientPool(dialect, config, supportsPool) {
  var pool = config.pool;
  if (pool === undefined || pool === false) return;

  if (!supportsPool) {
    throw publicError.create('NuBloxSQL dialect "' + dialect + '" does not support connection pools', {
      code: publicError.CODES.UNSUPPORTED,
      category: require('./Error').CATEGORIES.UNSUPPORTED,
      dialect: dialect,
      operation: 'connection pools'
    });
  }

  if (pool === true) return;
  if (!pool || typeof pool !== 'object' || Array.isArray(pool)) {
    throw configError('pool must be false, true, or an options object', TypeError, dialect);
  }

  var normalized = Object.assign({}, pool);
  if (normalized.max !== undefined) {
    optionalInteger(normalized, 'max', { min: 1 }, dialect);
    if (normalized.connectionLimit !== undefined && normalized.connectionLimit !== normalized.max) {
      throw configError('pool.max and pool.connectionLimit must match when both are provided', RangeError, dialect);
    }
    normalized.connectionLimit = normalized.max;
  }
  delete normalized.max;
  validatePoolOptions(normalized, dialect);

  if (config.connectionLimit !== undefined && normalized.connectionLimit !== undefined && config.connectionLimit !== normalized.connectionLimit) {
    throw configError('top-level connectionLimit conflicts with pool connection limit', RangeError, dialect);
  }
  if (config.maxIdle !== undefined && normalized.maxIdle !== undefined && config.maxIdle !== normalized.maxIdle) {
    throw configError('top-level maxIdle conflicts with pool.maxIdle', RangeError, dialect);
  }
}

function validateClientConfig(dialect, config, supportsPool) {
  validateConnectionConfig(dialect, config);
  validatePoolOptions(config, dialect);
  validateClientPool(dialect, config, supportsPool);
  return config;
}

exports.validateConnectionConfig = validateConnectionConfig;
exports.validatePoolConfig = validatePoolConfig;
exports.validateClientConfig = validateClientConfig;
exports.validatePoolOptions = validatePoolOptions;
exports.configError = configError;
