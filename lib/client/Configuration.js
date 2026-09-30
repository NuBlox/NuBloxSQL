'use strict';

function configError(message, Type) {
  var ErrorType = Type || TypeError;
  var error = new ErrorType('NuBloxSQL configuration: ' + message);
  error.code = 'NUBLOXSQL_CONFIGURATION';
  return error;
}

function requireObject(config, label) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw configError((label || 'configuration') + ' must be an options object');
  }
  return config;
}

function optionalString(config, name, options) {
  if (config[name] === undefined) return;
  options = options || {};
  if (typeof config[name] !== 'string') throw configError(name + ' must be a string');
  if (options.nonEmpty && config[name].trim().length === 0) throw configError(name + ' must not be empty');
}

function optionalBoolean(config, name) {
  if (config[name] !== undefined && typeof config[name] !== 'boolean') {
    throw configError(name + ' must be a boolean');
  }
}

function optionalInteger(config, name, options) {
  if (config[name] === undefined) return;
  options = options || {};
  var value = config[name];
  if (!Number.isInteger(value)) throw configError(name + ' must be an integer', RangeError);
  if (options.min !== undefined && value < options.min) {
    throw configError(name + ' must be at least ' + options.min, RangeError);
  }
  if (options.max !== undefined && value > options.max) {
    throw configError(name + ' must be at most ' + options.max, RangeError);
  }
}

function validateConnectionConfig(dialect, config) {
  requireObject(config, 'connection configuration');

  if (dialect !== 'sqlite') {
    optionalString(config, 'host', { nonEmpty: true });
    optionalInteger(config, 'port', { min: 1, max: 65535 });
    optionalString(config, 'user', { nonEmpty: true });
    optionalString(config, 'password');
    optionalString(config, 'database');
  }

  optionalInteger(config, 'connectTimeout', { min: 0 });
  return config;
}

function validatePoolOptions(config) {
  requireObject(config, 'pool configuration');
  optionalInteger(config, 'connectionLimit', { min: 1 });
  optionalInteger(config, 'maxIdle', { min: 1 });
  optionalInteger(config, 'idleTimeout', { min: 0 });
  optionalInteger(config, 'acquireTimeout', { min: 1 });
  optionalInteger(config, 'queueLimit', { min: 0 });
  optionalBoolean(config, 'resetOnRelease');

  if (config.connectionLimit !== undefined && config.maxIdle !== undefined && config.maxIdle > config.connectionLimit) {
    throw configError('maxIdle must not exceed connectionLimit', RangeError);
  }

  return config;
}

function validatePoolConfig(dialect, config) {
  validateConnectionConfig(dialect, config);
  validatePoolOptions(config);
  return config;
}

function validateClientPool(dialect, config, supportsPool) {
  var pool = config.pool;
  if (pool === undefined || pool === false) return;

  if (!supportsPool) {
    throw configError('dialect "' + dialect + '" does not support connection pools', RangeError);
  }

  if (pool === true) return;
  if (!pool || typeof pool !== 'object' || Array.isArray(pool)) {
    throw configError('pool must be false, true, or an options object');
  }

  var normalized = Object.assign({}, pool);
  if (normalized.max !== undefined) {
    optionalInteger(normalized, 'max', { min: 1 });
    if (normalized.connectionLimit !== undefined && normalized.connectionLimit !== normalized.max) {
      throw configError('pool.max and pool.connectionLimit must match when both are provided', RangeError);
    }
    normalized.connectionLimit = normalized.max;
  }
  delete normalized.max;
  validatePoolOptions(normalized);

  if (config.connectionLimit !== undefined && normalized.connectionLimit !== undefined && config.connectionLimit !== normalized.connectionLimit) {
    throw configError('top-level connectionLimit conflicts with pool connection limit', RangeError);
  }
  if (config.maxIdle !== undefined && normalized.maxIdle !== undefined && config.maxIdle !== normalized.maxIdle) {
    throw configError('top-level maxIdle conflicts with pool.maxIdle', RangeError);
  }
}

function validateClientConfig(dialect, config, supportsPool) {
  validateConnectionConfig(dialect, config);
  validatePoolOptions(config);
  validateClientPool(dialect, config, supportsPool);
  return config;
}

exports.validateConnectionConfig = validateConnectionConfig;
exports.validatePoolConfig = validatePoolConfig;
exports.validateClientConfig = validateClientConfig;
exports.validatePoolOptions = validatePoolOptions;
exports.configError = configError;
