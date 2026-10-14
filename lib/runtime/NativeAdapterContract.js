'use strict';

// A native database adapter is a protocol/runtime implementation, not a SQL
// dialect description. This contract is shared across data models but does
// not register, connect to or claim qualification for any unsupported engine.
const SCHEMA_VERSION = 1;
const MODELS = Object.freeze([
  'relational', 'document', 'key-value', 'graph', 'wide-column',
  'search', 'time-series', 'vector'
]);
const INTERFACES = Object.freeze([
  'sql', 'document-api', 'command-api', 'cypher', 'cql',
  'search-api', 'time-series-api', 'vector-api', 'multi-api'
]);

function nonEmpty(value, label) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new TypeError(label + ' must be a nonempty string');
  }
  return value.trim();
}
function uniqueStrings(value, label, allowed) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new TypeError(label + ' must be a nonempty array');
  }
  const entries = value.map(item => nonEmpty(item, label + ' entry'));
  if (new Set(entries).size !== entries.length) {
    throw new RangeError(label + ' must not contain duplicates');
  }
  for (const item of entries) {
    if (allowed && !allowed.includes(item)) {
      throw new RangeError('unknown ' + label + ': ' + item);
    }
  }
  return Object.freeze(entries);
}
function define(spec) {
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) {
    throw new TypeError('native adapter declaration must be an object');
  }
  const keys = ['id','models','nativeInterface','operations'];
  for (const key of Object.keys(spec)) {
    if (!keys.includes(key)) {
      throw new TypeError('unknown native adapter declaration field: ' + key);
    }
  }
  const id = nonEmpty(spec.id, 'native adapter id');
  if (!/^[a-z][a-z0-9-]*$/.test(id)) {
    throw new RangeError('native adapter id must be lowercase kebab-case');
  }
  const models = uniqueStrings(spec.models, 'native adapter models', MODELS);
  const nativeInterface = nonEmpty(spec.nativeInterface, 'native adapter interface');
  if (!INTERFACES.includes(nativeInterface)) {
    throw new RangeError('unsupported native adapter interface: ' + nativeInterface);
  }
  const operations = uniqueStrings(spec.operations, 'native adapter operations');
  if (nativeInterface === 'sql') {
    if (!models.includes('relational') || !operations.includes('sql.query')) {
      throw new RangeError('SQL native adapters must declare relational model and sql.query');
    }
  }
  return Object.freeze({
    schemaVersion: SCHEMA_VERSION, id, models, nativeInterface, operations
  });
}
function assertRuntime(declaration, implementation) {
  if (!declaration || declaration.schemaVersion !== SCHEMA_VERSION) {
    throw new TypeError('native adapter runtime requires a validated declaration');
  }
  if (!implementation || typeof implementation !== 'object' ||
      typeof implementation.createConnection !== 'function') {
    throw new TypeError('native adapter "' + declaration.id +
      '" must implement createConnection(config)');
  }
  const descriptor = implementation.descriptor;
  if (!descriptor || !descriptor.identity ||
      descriptor.identity.family !== declaration.id) {
    throw new TypeError('native adapter "' + declaration.id +
      '" must expose a matching descriptor.identity.family');
  }
  if (declaration.nativeInterface === 'sql') {
    if (!descriptor.services || typeof descriptor.services.quoteIdentifier !== 'function' ||
        typeof descriptor.services.placeholder !== 'function') {
      throw new TypeError('SQL native adapter "' + declaration.id +
        '" requires quoteIdentifier and placeholder dialect services');
    }
  }
  return implementation;
}

module.exports = Object.freeze({SCHEMA_VERSION, MODELS, INTERFACES, define, assertRuntime});
