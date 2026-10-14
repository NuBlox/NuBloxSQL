'use strict';

// Internal SQL adapter routing extracted from the public entry point.
// Protocol adapters remain lazy, while unsupported vendors fail closed.
// Future non-SQL adapters require their own native interface routing, not
// entry through createClient({dialect:...}).
const nativeContract = require('./NativeAdapterContract');

function has(record, name) {
  return Object.prototype.hasOwnProperty.call(record, name);
}
function copyConfig(source, target, excluded) {
  Object.keys(source || {}).forEach(function (key) {
    if (!excluded || excluded.indexOf(key) === -1) target[key] = source[key];
  });
  return target;
}
function create(options) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError('SQL adapter router requires options');
  }
  const loaders = options.loaders;
  const connectionUrlApi = options.connectionUrl;
  const publicErrorApi = options.errors;
  if (!loaders || typeof loaders !== 'object' || Array.isArray(loaders) ||
      !connectionUrlApi || typeof connectionUrlApi.isUrlLike !== 'function' ||
      typeof connectionUrlApi.parse !== 'function' ||
      !publicErrorApi || typeof publicErrorApi.routingError !== 'function' ||
      typeof publicErrorApi.unsupportedDialectError !== 'function' ||
      typeof publicErrorApi.configurationError !== 'function') {
    throw new TypeError('SQL adapter router requires loaders, connection URLs and public errors');
  }
  const ids = Object.keys(loaders);
  if (ids.length === 0) throw new RangeError('SQL adapter router requires native loaders');
  const DIALECTS = {};
  const declarations = Object.create(null);
  for (const id of ids) {
    if (!/^[a-z][a-z0-9-]*$/.test(id) || typeof loaders[id] !== 'function') {
      throw new TypeError('SQL adapter loader requires a lowercase id and function');
    }
    DIALECTS[id] = id;
    declarations[id] = nativeContract.define({
      id, models: ['relational'], nativeInterface: 'sql', operations: ['sql.query']
    });
  }
  Object.freeze(DIALECTS);
  Object.freeze(declarations);
  const cache = Object.create(null);

  function normalizeDialect(value) {
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw publicErrorApi.routingError('NuBloxSQL requires a dialect: ' +
        (ids.length > 1 ? ids.slice(0, -1).join(', ') + ' or ' + ids[ids.length - 1] : ids[0]));
    }
    let dialect = value.trim().toLowerCase();
    if (dialect === 'postgres' || dialect === 'pg') dialect = 'postgresql';
    if (dialect === 'mssql' || dialect === 'sql-server') dialect = 'sqlserver';
    if (!has(loaders, dialect)) throw publicErrorApi.unsupportedDialectError(value);
    return dialect;
  }
  function loadAdapter(dialect) {
    const normalized = normalizeDialect(dialect);
    if (!has(cache, normalized)) {
      // Do not cache a failed or incomplete load. The adapter is evaluated
      // lazily only after a valid, supported dialect was selected.
      const candidate = loaders[normalized]();
      nativeContract.assertRuntime(declarations[normalized], candidate);
      cache[normalized] = candidate;
    }
    return cache[normalized];
  }
  function resolveInvocation(dialectOrConfig, maybeConfig) {
    let dialect, config, parsed;
    if (connectionUrlApi.isUrlLike(dialectOrConfig)) {
      parsed = connectionUrlApi.parse(dialectOrConfig);
      dialect = parsed.dialect;
      config = copyConfig(maybeConfig || {}, copyConfig(parsed.config, {}));
    } else if (typeof dialectOrConfig === 'string') {
      dialect = normalizeDialect(dialectOrConfig);
      config = maybeConfig || {};
    } else {
      config = dialectOrConfig || {};
      if (!config || typeof config !== 'object' || Array.isArray(config)) {
        throw publicErrorApi.configurationError('connection configuration must be an object');
      }
      if (config.url !== undefined) {
        parsed = connectionUrlApi.parse(config.url);
        if (config.dialect !== undefined &&
            normalizeDialect(config.dialect) !== parsed.dialect) {
          throw publicErrorApi.routingError(
            'NuBloxSQL connection URL dialect does not match explicit dialect: ' +
              config.dialect,
            { dialect: normalizeDialect(config.dialect) }
          );
        }
        dialect = parsed.dialect;
        config = copyConfig(config, copyConfig(parsed.config, {}), ['dialect','url']);
      } else dialect = normalizeDialect(config.dialect);
    }
    if (!config || typeof config !== 'object' || Array.isArray(config)) {
      throw publicErrorApi.configurationError('connection configuration must be an object', dialect);
    }
    const adapterConfig = {};
    Object.keys(config).forEach(function (key) {
      if (key !== 'dialect' && key !== 'url') adapterConfig[key] = config[key];
    });
    return { dialect, adapter: loadAdapter(dialect), config: adapterConfig };
  }
  return Object.freeze({DIALECTS, normalizeDialect, loadAdapter, resolveInvocation});
}

module.exports = Object.freeze({create});
