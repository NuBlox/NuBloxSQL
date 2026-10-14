'use strict';

// Native non-SQL routing is deliberately independent of SqlAdapterRouter.
// Closed, lazily loaded model-specific adapters are not SQL dialects.
const registry = require('./NativeAdapterRegistry').create([{
  id:'redis',models:['key-value'],nativeInterface:'command-api',
  operations:['key-value.command'],
  load:() => require('../dialects/redis')
},{
  id:'mongodb',models:['document'],nativeInterface:'document-api',
  operations:['document.read','document.write'],
  load:() => require('../dialects/mongodb')
}]);

function createNativeConnection(technologyOrConfig, maybeConfig) {
  let technology, config;
  if (typeof technologyOrConfig === 'string') {
    technology = technologyOrConfig;
    config = maybeConfig === undefined ? {} : maybeConfig;
  } else if (technologyOrConfig && typeof technologyOrConfig === 'object' &&
             !Array.isArray(technologyOrConfig)) {
    technology = technologyOrConfig.technology;
    config = {};
    for (const key of Object.keys(technologyOrConfig)) {
      if (key !== 'technology') config[key] = technologyOrConfig[key];
    }
  } else throw new TypeError('Native connection requires a technology and options object');
  if (typeof technology !== 'string' || !registry.get(technology)) {
    throw new RangeError('Unsupported native non-SQL technology');
  }
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw new TypeError('Native connection config must be an options object');
  }
  const declaration=registry.get(technology);
  return registry.load(technology,declaration.operations[0]).createConnection(config);
}
module.exports = Object.freeze({createNativeConnection});
