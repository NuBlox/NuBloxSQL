'use strict';

var Diagnostics = require('diagnostics_channel');

var ResolveStartChannel = Diagnostics.channel('nublox.mysql.credentials.resolve.start');
var ResolveEndChannel = Diagnostics.channel('nublox.mysql.credentials.resolve.end');
var ResolveErrorChannel = Diagnostics.channel('nublox.mysql.credentials.resolve.error');

exports.resolve = resolve;
exports.apply = apply;

function resolve(config) {
  var provider = config && config.credentialProvider;

  if (typeof provider !== 'function') {
    return null;
  }

  var started = process.hrtime.bigint();
  var context = Object.freeze({
    host       : config.host,
    port       : config.port,
    socketPath : config.socketPath,
    user       : config.user,
    database   : config.database,
    secure     : Boolean(config.ssl || config.socketPath)
  });

  publish(ResolveStartChannel, {
    host     : config.host,
    port     : config.port,
    user     : config.user,
    database : config.database,
    secure   : context.secure
  });

  var result;
  try {
    result = provider(context);
  } catch (error) {
    throw providerError(error, started, config);
  }

  if (result && typeof result.then === 'function') {
    return result.then(function(credentials) {
      var normalized = normalize(credentials);
      publishEnd(started, config);
      return normalized;
    }, function(error) {
      throw providerError(error, started, config);
    });
  }

  var normalized = normalize(result);
  publishEnd(started, config);
  return normalized;
}

function apply(config, credentials) {
  if (!credentials) {
    return config;
  }

  if (credentials.user !== undefined) {
    config.user = credentials.user;
  }
  if (credentials.password !== undefined) {
    config.password = credentials.password;
  }
  if (credentials.database !== undefined) {
    config.database = credentials.database;
  }

  return config;
}

function normalize(value) {
  if (typeof value === 'string') {
    return {password: value};
  }

  if (!value || typeof value !== 'object' || !Object.prototype.hasOwnProperty.call(value, 'password')) {
    throw invalidResultError('credentialProvider must return a password string or an object containing password');
  }

  if (typeof value.password !== 'string') {
    throw invalidResultError('credentialProvider password must be a string');
  }
  if (value.user !== undefined && typeof value.user !== 'string') {
    throw invalidResultError('credentialProvider user must be a string when provided');
  }
  if (value.database !== undefined && typeof value.database !== 'string') {
    throw invalidResultError('credentialProvider database must be a string when provided');
  }

  return {
    user     : value.user,
    password : value.password,
    database : value.database
  };
}

function invalidResultError(message) {
  var error = new TypeError(message);
  error.code = 'CREDENTIAL_PROVIDER_INVALID_RESULT';
  return error;
}

function providerError(cause, started, config) {
  var error = cause instanceof Error ? cause : new Error(String(cause));

  if (!error.code || error.code === 'CREDENTIAL_PROVIDER_INVALID_RESULT') {
    error.code = error.code || 'CREDENTIAL_PROVIDER_ERROR';
  }
  error.fatal = true;

  publish(ResolveErrorChannel, {
    durationMs : durationMs(started),
    errorCode  : error.code,
    host       : config.host,
    port       : config.port,
    user       : config.user,
    database   : config.database
  });
  return error;
}

function publishEnd(started, config) {
  publish(ResolveEndChannel, {
    durationMs : durationMs(started),
    host       : config.host,
    port       : config.port,
    user       : config.user,
    database   : config.database
  });
}

function publish(channel, event) {
  if (channel.hasSubscribers) {
    channel.publish(event);
  }
}

function durationMs(started) {
  return Number(process.hrtime.bigint() - started) / 1000000;
}
