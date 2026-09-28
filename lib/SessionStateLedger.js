'use strict';

module.exports = SessionStateLedger;
SessionStateLedger.decorateConnection = decorateConnection;
SessionStateLedger.decoratePool = decoratePool;
SessionStateLedger.decoratePromiseConnection = decoratePromiseConnection;
SessionStateLedger.decoratePromisePool = decoratePromisePool;

function SessionStateLedger(config) {
  this._configuredDatabase = config && config.database || null;
  this.reset();
}

SessionStateLedger.prototype.reset = function reset() {
  this._state = {
    version                    : 0,
    schema                     : this._configuredDatabase,
    systemVariables            : Object.create(null),
    stateChanged               : null,
    gtids                      : null,
    gtidEncoding               : null,
    transactionCharacteristics : null,
    transactionState           : null,
    unknown                    : []
  };
};

SessionStateLedger.prototype.apply = function apply(changes) {
  if (!Array.isArray(changes) || changes.length === 0) {
    return;
  }

  for (var i = 0; i < changes.length; i++) {
    this._applyChange(changes[i]);
  }

  this._state.version++;
};

SessionStateLedger.prototype.snapshot = function snapshot() {
  var variables = Object.create(null);
  var keys = Object.keys(this._state.systemVariables);

  for (var i = 0; i < keys.length; i++) {
    variables[keys[i]] = this._state.systemVariables[keys[i]];
  }

  return {
    version                    : this._state.version,
    schema                     : this._state.schema,
    systemVariables            : variables,
    stateChanged               : this._state.stateChanged,
    gtids                      : this._state.gtids,
    gtidEncoding               : this._state.gtidEncoding,
    transactionCharacteristics : this._state.transactionCharacteristics,
    transactionState           : this._state.transactionState,
    unknown                    : this._state.unknown.map(cloneUnknown)
  };
};

SessionStateLedger.prototype._applyChange = function _applyChange(change) {
  if (!change || typeof change !== 'object') {
    return;
  }

  switch (change.name) {
    case 'system_variables':
      if (typeof change.variable === 'string') {
        this._state.systemVariables[change.variable] = change.value;
      }
      return;
    case 'schema':
      this._state.schema = change.value;
      return;
    case 'state_change':
      this._state.stateChanged = change.value;
      return;
    case 'gtids':
      this._state.gtids = change.value;
      this._state.gtidEncoding = change.encoding === undefined ? null : change.encoding;
      return;
    case 'transaction_characteristics':
      this._state.transactionCharacteristics = change.value;
      return;
    case 'transaction_state':
      this._state.transactionState = change.value;
      return;
    default:
      this._state.unknown.push({
        type : change.type,
        data : change.data && Buffer.isBuffer(change.data)
          ? Buffer.from(change.data)
          : Buffer.alloc(0)
      });
  }
};

function decorateConnection(connection) {
  if (connection._nubloxSessionStateLedgerDecorated) {
    return connection;
  }

  var ledger = new SessionStateLedger(connection.config);
  var originalResetConnection = connection.resetConnection;

  connection._protocol.on('session-state', function onSessionState(changes) {
    ledger.apply(changes);
    connection.emit('sessionStateChange', changes, ledger.snapshot());
  });

  defineMethod(connection, 'sessionStateSnapshot', function sessionStateSnapshot() {
    return ledger.snapshot();
  });

  if (typeof originalResetConnection === 'function') {
    defineMethod(connection, 'resetConnection', function resetConnection(options, callback) {
      if (typeof options === 'function') {
        callback = options;
        options = {};
      }

      var userCallback = callback;
      return originalResetConnection.call(this, options || {}, function onReset(error, packet) {
        if (!error) {
          ledger.reset();
        }

        if (typeof userCallback === 'function') {
          userCallback(error, packet);
        } else if (error) {
          process.nextTick(function throwResetError() {
            throw error;
          });
        }
      });
    });
  }

  Object.defineProperty(connection, '_nubloxSessionStateLedgerDecorated', {
    configurable : true,
    enumerable   : false,
    value        : true,
    writable     : false
  });

  return connection;
}

function decoratePool(pool) {
  if (pool._nubloxSessionStateLedgerDecorated) {
    return pool;
  }

  var originalGetConnection = pool.getConnection;
  defineMethod(pool, 'getConnection', function getConnection(callback) {
    return originalGetConnection.call(this, function onConnection(error, connection) {
      if (connection) {
        decorateConnection(connection);
      }
      callback(error, connection);
    });
  });

  Object.defineProperty(pool, '_nubloxSessionStateLedgerDecorated', {
    configurable : true,
    enumerable   : false,
    value        : true,
    writable     : false
  });

  return pool;
}

function decoratePromiseConnection(promiseConnection) {
  var prototype = Object.getPrototypeOf(promiseConnection);

  if (prototype._nubloxSessionStateLedgerDecorated) {
    return promiseConnection;
  }

  defineMethod(prototype, 'sessionStateSnapshot', function sessionStateSnapshot() {
    return decorateConnection(this.connection).sessionStateSnapshot();
  });

  Object.defineProperty(prototype, '_nubloxSessionStateLedgerDecorated', {
    configurable : true,
    enumerable   : false,
    value        : true,
    writable     : false
  });

  return promiseConnection;
}

function decoratePromisePool(promisePool) {
  if (promisePool._nubloxSessionStateLedgerDecorated) {
    return promisePool;
  }

  var originalGetConnection = promisePool.getConnection;
  defineMethod(promisePool, 'getConnection', function getConnection() {
    return originalGetConnection.call(this).then(function onConnection(connection) {
      decorateConnection(connection.connection);
      return decoratePromiseConnection(connection);
    });
  });

  Object.defineProperty(promisePool, '_nubloxSessionStateLedgerDecorated', {
    configurable : true,
    enumerable   : false,
    value        : true,
    writable     : false
  });

  return promisePool;
}

function cloneUnknown(change) {
  return {
    type : change.type,
    data : Buffer.from(change.data)
  };
}

function defineMethod(target, name, method) {
  var descriptor = Object.getOwnPropertyDescriptor(target, name) || {
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
