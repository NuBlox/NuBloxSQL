'use strict';

var TypeRegistry = require('./Types').TypeRegistry;

function registry(receiver) {
  var client = receiver.client || receiver;
  if (!client._typeRegistry) client._typeRegistry = new TypeRegistry(client, client.config && client.config.types);
  return client._typeRegistry;
}

function defineTypes(prototype) {
  if (!prototype || Object.getOwnPropertyDescriptor(prototype, 'types')) return;
  Object.defineProperty(prototype, 'types', {
    enumerable: true,
    configurable: false,
    get: function () { return registry(this); }
  });
}

function wrapCompile(prototype) {
  if (!prototype || typeof prototype.compile !== 'function') return;
  var original = prototype.compile;
  if (original._nubloxTypes) return;
  function compileWithCodecs() {
    var compiled = original.apply(this, arguments);
    var encoded = registry(this).encodeParameters(Array.prototype.slice.call(compiled.parameters || []));
    if (encoded === compiled.parameters) return compiled;
    return Object.freeze(Object.assign({}, compiled, { parameters: Object.freeze(encoded) }));
  }
  Object.defineProperty(compileWithCodecs, '_nubloxTypes', { value: true });
  prototype.compile = compileWithCodecs;
}

function wrapPreparedParameters(prototype) {
  if (!prototype || typeof prototype._parameters !== 'function') return;
  var original = prototype._parameters;
  if (original._nubloxTypes) return;
  function parametersWithCodecs() {
    return registry(this).encodeParameters(original.apply(this, arguments));
  }
  Object.defineProperty(parametersWithCodecs, '_nubloxTypes', { value: true });
  prototype._parameters = parametersWithCodecs;
}

function wrapResult(prototype, method) {
  if (!prototype || typeof prototype[method] !== 'function') return;
  var original = prototype[method];
  if (original._nubloxTypes) return;
  function resultWithCodecs() {
    var self = this;
    var result = original.apply(this, arguments);
    if (result && typeof result.then === 'function') return result.then(function (value) { return registry(self).decodeResult(value); });
    return registry(this).decodeResult(result);
  }
  Object.defineProperty(resultWithCodecs, '_nubloxTypes', { value: true });
  prototype[method] = resultWithCodecs;
}

function wrapStreamNext(streamApi) {
  if (!streamApi || !streamApi.ClientRowStream || typeof streamApi.ClientRowStream.prototype.next !== 'function') return;
  var original = streamApi.ClientRowStream.prototype.next;
  if (original._nubloxTypes) return;
  async function nextWithCodecs() {
    var item = await original.apply(this, arguments);
    if (!item || item.done) return item;
    var rows = registry(this.client).decodeRows([item.value], this.fields || []);
    return { value: rows[0], done: false };
  }
  Object.defineProperty(nextWithCodecs, '_nubloxTypes', { value: true });
  streamApi.ClientRowStream.prototype.next = nextWithCodecs;
}

function install(clientApi, streamApi) {
  defineTypes(clientApi.Client && clientApi.Client.prototype);
  defineTypes(clientApi.PreparedClientStatement && clientApi.PreparedClientStatement.prototype);
  wrapCompile(clientApi.Client && clientApi.Client.prototype);
  wrapPreparedParameters(clientApi.PreparedClientStatement && clientApi.PreparedClientStatement.prototype);
  wrapResult(clientApi.Client && clientApi.Client.prototype, 'query');
  wrapResult(clientApi.Client && clientApi.Client.prototype, 'execute');
  wrapResult(clientApi.PreparedClientStatement && clientApi.PreparedClientStatement.prototype, 'query');
  wrapResult(clientApi.PreparedClientStatement && clientApi.PreparedClientStatement.prototype, 'execute');
  wrapStreamNext(streamApi);
}

exports.install = install;
exports.registry = registry;
