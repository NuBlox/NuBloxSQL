'use strict';

var control = require('./OperationControl');

function wrap(prototype, method, optionsIndex) {
  if (!prototype || typeof prototype[method] !== 'function') return;
  var original = prototype[method];
  if (original._nubloxOperationControl) return;

  function controlledOperation() {
    var args = Array.prototype.slice.call(arguments);
    args[optionsIndex] = control.normalize(this.client || this, method, args[optionsIndex]);
    return original.apply(this, args);
  }

  Object.defineProperty(controlledOperation, '_nubloxOperationControl', { value: true });
  prototype[method] = controlledOperation;
}

function install(clientApi) {
  ['query', 'execute', 'prepare', 'transaction', 'stream', 'diagnose'].forEach(function (method) {
    wrap(clientApi.Client && clientApi.Client.prototype, method, 1);
  });
  ['query', 'execute'].forEach(function (method) {
    wrap(clientApi.PreparedClientStatement && clientApi.PreparedClientStatement.prototype, method, 1);
  });
}

exports.install = install;
