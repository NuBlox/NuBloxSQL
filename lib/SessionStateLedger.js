'use strict';

module.exports = SessionStateLedger;

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

function cloneUnknown(change) {
  return {
    type : change.type,
    data : Buffer.from(change.data)
  };
}
