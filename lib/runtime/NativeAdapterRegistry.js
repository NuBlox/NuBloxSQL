'use strict';

// Fixed, driver-internal adapter registry. Registration is an atomic factory
// operation; no application, catalogue entry or third-party plugin can append
// executable adapters after creation. Declarations are NOT proof of live support.
const contract = require('./NativeAdapterContract');

function has(record, key) {
  return Object.prototype.hasOwnProperty.call(record, key);
}
function create(registrations) {
  if (!Array.isArray(registrations) || registrations.length === 0) {
    throw new TypeError('native adapter registry requires a nonempty registration array');
  }

  const registrationsById = Object.create(null);
  const declarations = [];
  // Validate all registrations before exposing a partially built registry.
  for (const registration of registrations) {
    if (!registration || typeof registration !== 'object' || Array.isArray(registration)) {
      throw new TypeError('native adapter registration must be an object');
    }
    const fields = ['id', 'models', 'nativeInterface', 'operations', 'load'];
    for (const field of Object.keys(registration)) {
      if (!fields.includes(field)) {
        throw new TypeError('unknown native adapter registration field: ' + field);
      }
    }
    const declaration = contract.define({
      id: registration.id,
      models: registration.models,
      nativeInterface: registration.nativeInterface,
      operations: registration.operations
    });
    if (typeof registration.load !== 'function') {
      throw new TypeError('native adapter loader must be a function');
    }
    if (has(registrationsById, declaration.id)) {
      throw new RangeError('duplicate native adapter registration');
    }
    // A reference to the loader is private; public descriptions never expose
    // module code, vendor credentials or connection configuration.
    registrationsById[declaration.id] = Object.freeze({
      declaration,
      load: registration.load
    });
    declarations.push(declaration);
  }
  Object.freeze(registrationsById);
  Object.freeze(declarations);
  const loaded = Object.create(null);
  const loading = new Set();

  function find(id) {
    if (typeof id !== 'string') return null;
    return has(registrationsById, id) ? registrationsById[id] : null;
  }
  function get(id) {
    const entry = find(id);
    return entry ? entry.declaration : null;
  }
  function list() {
    return declarations;
  }
  function load(id, operation) {
    const entry = find(id);
    if (!entry) throw new RangeError('native adapter is not registered');
    if (operation !== undefined) {
      if (typeof operation !== 'string' || !operation ||
          !entry.declaration.operations.includes(operation)) {
        throw new RangeError('native adapter operation is not declared');
      }
    }
    if (has(loaded, id)) return loaded[id];
    if (loading.has(id)) throw new Error('recursive native adapter loading is not supported');
    loading.add(id);
    try {
      const implementation = contract.assertRuntime(entry.declaration, entry.load());
      loaded[id] = implementation;
      return implementation;
    } finally {
      loading.delete(id);
    }
  }

  return Object.freeze({get, list, load});
}
module.exports = Object.freeze({create});
