'use strict';

// SQL client connection/pool creation policy. Database adapters retain
// ownership of native connection and pool implementation/validation.
function copyWithoutClientKeys(config) {
  var out = {};
  Object.keys(config || {}).forEach(function (key) {
    if (key !== 'dialect' && key !== 'pool') out[key] = config[key];
  });
  return out;
}

function createPoolConfig(config) {
  var out = copyWithoutClientKeys(config);
  var pool = config && config.pool;
  if (!pool || pool === true) return out;
  if (typeof pool !== 'object' || Array.isArray(pool)) throw new TypeError('NuBloxSQL pool must be false, true, or an options object');
  Object.keys(pool).forEach(function (key) {
    if (key === 'max') out.connectionLimit = pool[key];
    else out[key] = pool[key];
  });
  return out;
}

function createTarget(adapter, config) {
  if (typeof adapter.createPool === 'function' && config.pool !== false) {
    return { target: adapter.createPool(createPoolConfig(config)), isPool: true };
  }
  return { target: adapter.createConnection(copyWithoutClientKeys(config)), isPool: false };
}

module.exports = Object.freeze({copyWithoutClientKeys, createPoolConfig, createTarget});
