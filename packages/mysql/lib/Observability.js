'use strict';

var diagnosticsChannel = require('diagnostics_channel');

var CHANNEL_NAMES = Object.freeze({
  connection: 'nublox.mysql.connection',
  statement: 'nublox.mysql.statement',
  pool: 'nublox.mysql.pool'
});

var channels = {
  connection: diagnosticsChannel.channel(CHANNEL_NAMES.connection),
  statement: diagnosticsChannel.channel(CHANNEL_NAMES.statement),
  pool: diagnosticsChannel.channel(CHANNEL_NAMES.pool)
};

var nextTargetId = 1;

function targetId(target, prefix) {
  if (!target) return null;
  if (!Object.prototype.hasOwnProperty.call(target, '_nubloxDiagnosticId')) {
    Object.defineProperty(target, '_nubloxDiagnosticId', {
      configurable: false,
      enumerable: false,
      writable: false,
      value: prefix + nextTargetId++
    });
  }
  return target._nubloxDiagnosticId;
}

function durationMilliseconds(startedAt) {
  return Number(process.hrtime.bigint() - startedAt) / 1000000;
}

function errorMetadata(error) {
  if (!error) return null;
  return {
    name: error.name || 'Error',
    code: error.code === undefined ? null : error.code,
    sqlState: error.sqlState === undefined ? null : error.sqlState
  };
}

function resultMetadata(result) {
  if (!result || typeof result !== 'object') return null;
  var metadata = {};
  if (result.rowCount !== undefined) metadata.rowCount = result.rowCount;
  else if (Array.isArray(result.rows)) metadata.rowCount = result.rows.length;
  if (result.fieldCount !== undefined) metadata.fieldCount = result.fieldCount;
  else if (Array.isArray(result.fields)) metadata.fieldCount = result.fields.length;
  if (result.affectedRows !== undefined) metadata.affectedRows = result.affectedRows;
  if (result.warningCount !== undefined) metadata.warningCount = result.warningCount;
  if (result.connected !== undefined) metadata.connected = Boolean(result.connected);
  return Object.keys(metadata).length ? metadata : null;
}

function publish(channel, message) {
  if (!channel || !channel.hasSubscribers) return;
  channel.publish(message);
}

function startContext(channelName, operation, target, prefix, details) {
  var context = {
    channel: channels[channelName],
    channelName: CHANNEL_NAMES[channelName],
    operation: operation,
    targetId: targetId(target, prefix),
    startedAt: process.hrtime.bigint(),
    completed: false
  };
  publish(context.channel, {
    channel: context.channelName,
    phase: 'start',
    operation: operation,
    targetId: context.targetId,
    details: details || null
  });
  return context;
}

function finishContext(context, phase, result, error, details) {
  if (!context || context.completed) return;
  context.completed = true;
  publish(context.channel, {
    channel: context.channelName,
    phase: phase,
    operation: context.operation,
    targetId: context.targetId,
    durationMs: durationMilliseconds(context.startedAt),
    result: resultMetadata(result),
    error: errorMetadata(error),
    details: details || null
  });
}

function isPromise(value) {
  return value && typeof value.then === 'function';
}

function isStream(value) {
  return value && typeof value.once === 'function' && typeof value.destroy === 'function' && typeof value[Symbol.asyncIterator] === 'function';
}

function observeStream(stream, context) {
  function complete() {
    finishContext(context, 'success', {
      rowCount: stream.rowCount || 0,
      fieldCount: stream.fields ? stream.fields.length : 0,
      affectedRows: stream.affectedRows,
      warningCount: stream.warningCount
    });
  }
  function fail(error) {
    finishContext(context, 'error', null, error);
  }
  stream.once('end', complete);
  stream.once('error', fail);
  return stream;
}

function wrapMethod(prototype, name, channelName, operation, targetResolver, detailResolver) {
  if (!prototype || typeof prototype[name] !== 'function') return;
  var original = prototype[name];
  if (original._nubloxObserved) return;

  function observedMethod() {
    var target = targetResolver ? targetResolver(this) : this;
    var details = detailResolver ? detailResolver(this, arguments) : null;
    var prefix = channelName === 'pool' ? 'pool-' : (channelName === 'statement' ? 'stmt-' : 'conn-');
    var context = startContext(channelName, operation || name, target, prefix, details);
    var result;
    try {
      result = original.apply(this, arguments);
    } catch (error) {
      finishContext(context, 'error', null, error);
      throw error;
    }

    if (isPromise(result)) {
      return result.then(function (value) {
        if (isStream(value)) return observeStream(value, context);
        var completionDetails = null;
        if (value && value.connected !== undefined) completionDetails = { connectionId: targetId(value, 'conn-') };
        finishContext(context, 'success', value, null, completionDetails);
        return value;
      }, function (error) {
        finishContext(context, 'error', null, error);
        throw error;
      });
    }

    if (isStream(result)) return observeStream(result, context);
    finishContext(context, 'success', result);
    return result;
  }

  Object.defineProperty(observedMethod, '_nubloxObserved', { value: true });
  prototype[name] = observedMethod;
}

function install(runtime, pool) {
  var Connection = runtime && runtime.Connection;
  var PreparedStatement = runtime && runtime.PreparedStatement;
  var Pool = pool && pool.Pool;

  if (Connection) {
    wrapMethod(Connection.prototype, 'connect', 'connection', 'connect');
    wrapMethod(Connection.prototype, 'query', 'connection', 'query');
    wrapMethod(Connection.prototype, 'queryStream', 'connection', 'queryStream');
    wrapMethod(Connection.prototype, 'prepare', 'connection', 'prepare');
    wrapMethod(Connection.prototype, 'resetSession', 'connection', 'resetSession');
    wrapMethod(Connection.prototype, 'beginTransaction', 'connection', 'beginTransaction');
    wrapMethod(Connection.prototype, 'commit', 'connection', 'commit');
    wrapMethod(Connection.prototype, 'rollback', 'connection', 'rollback');
    wrapMethod(Connection.prototype, 'withTransaction', 'connection', 'withTransaction');
    wrapMethod(Connection.prototype, 'savepoint', 'connection', 'savepoint');
    wrapMethod(Connection.prototype, 'rollbackToSavepoint', 'connection', 'rollbackToSavepoint');
    wrapMethod(Connection.prototype, 'releaseSavepoint', 'connection', 'releaseSavepoint');
    wrapMethod(Connection.prototype, 'end', 'connection', 'end');
  }

  if (PreparedStatement) {
    wrapMethod(PreparedStatement.prototype, 'execute', 'statement', 'execute', function (statement) { return statement; }, function (statement) {
      return { connectionId: targetId(statement.connection, 'conn-'), statementId: statement.id };
    });
    wrapMethod(PreparedStatement.prototype, 'reset', 'statement', 'reset', function (statement) { return statement; }, function (statement) {
      return { connectionId: targetId(statement.connection, 'conn-'), statementId: statement.id };
    });
    wrapMethod(PreparedStatement.prototype, 'close', 'statement', 'close', function (statement) { return statement; }, function (statement) {
      return { connectionId: targetId(statement.connection, 'conn-'), statementId: statement.id };
    });
  }

  if (Pool) {
    wrapMethod(Pool.prototype, 'getConnection', 'pool', 'getConnection');
    wrapMethod(Pool.prototype, 'releaseConnection', 'pool', 'releaseConnection', null, function (instance, args) {
      return { connectionId: targetId(args[0], 'conn-') };
    });
    wrapMethod(Pool.prototype, 'query', 'pool', 'query');
    wrapMethod(Pool.prototype, 'queryStream', 'pool', 'queryStream');
    wrapMethod(Pool.prototype, 'execute', 'pool', 'execute');
    wrapMethod(Pool.prototype, 'withTransaction', 'pool', 'withTransaction');
    wrapMethod(Pool.prototype, 'end', 'pool', 'end');
  }
}

exports.CHANNEL_NAMES = CHANNEL_NAMES;
exports.install = install;
exports.targetId = targetId;
