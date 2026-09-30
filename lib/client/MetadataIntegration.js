'use strict';

var publicErrorApi = require('./PublicError');

function freezeObject(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  return Object.freeze(value);
}

function normalizeOptions(options, dialect) {
  if (options === undefined || options === null) options = {};
  if (typeof options !== 'object' || Array.isArray(options)) {
    throw publicErrorApi.configurationError('metadata introspection options must be an object', dialect);
  }
  if (options.deep !== undefined && typeof options.deep !== 'boolean') {
    throw publicErrorApi.configurationError('metadata introspection deep must be a boolean', dialect);
  }
  if (options.concurrency !== undefined && (!Number.isInteger(options.concurrency) || options.concurrency < 1)) {
    throw publicErrorApi.configurationError('metadata introspection concurrency must be a positive integer', dialect);
  }
  if (options.tables !== undefined) {
    if (!Array.isArray(options.tables) || options.tables.some(function (name) { return typeof name !== 'string' || name.length === 0; })) {
      throw publicErrorApi.configurationError('metadata introspection tables must be an array of non-empty table names', dialect);
    }
  }
  return options;
}

async function mapLimit(values, limit, worker) {
  var output = new Array(values.length);
  var next = 0;
  async function run() {
    while (true) {
      var index = next++;
      if (index >= values.length) return;
      output[index] = await worker(values[index], index);
    }
  }
  var workers = [];
  var count = Math.min(limit, values.length);
  for (var i = 0; i < count; i++) workers.push(run());
  await Promise.all(workers);
  return output;
}

function scopedOptions(options) {
  var scope = {};
  if (options.database !== undefined) scope.database = options.database;
  if (options.schema !== undefined) scope.schema = options.schema;
  if (options.includeSystem !== undefined) scope.includeSystem = options.includeSystem === true;
  return scope;
}

async function snapshot(catalog, options) {
  options = normalizeOptions(options, catalog.dialect);
  var scope = scopedOptions(options);
  var topLevel = await Promise.all([
    catalog.databases(),
    catalog.schemas(scope),
    catalog.tables(scope)
  ]);

  var tables = topLevel[2];
  if (options.tables) {
    var wanted = Object.create(null);
    options.tables.forEach(function (name) { wanted[name] = true; });
    tables = Object.freeze(tables.filter(function (table) { return wanted[table.name] === true; }));
  }

  if (options.deep !== false) {
    tables = Object.freeze(await mapLimit(tables, options.concurrency || 4, async function (summary) {
      var details = await Promise.all([
        catalog.columns(summary.name, scope),
        catalog.indexes(summary.name, scope),
        catalog.foreignKeys(summary.name, scope),
        catalog.constraints(summary.name, scope)
      ]);
      return Object.freeze(Object.assign({}, summary, {
        columns: details[0],
        indexes: details[1],
        foreignKeys: details[2],
        constraints: details[3]
      }));
    }));
  }

  return Object.freeze({
    dialect: catalog.dialect,
    scope: freezeObject(Object.assign({}, scope)),
    databases: topLevel[0],
    schemas: topLevel[1],
    tables: tables
  });
}

function install(clientApi, metadataApi) {
  if (!clientApi || !clientApi.Client || !metadataApi || !metadataApi.Metadata) return;
  var Client = clientApi.Client;
  var Metadata = metadataApi.Metadata;

  if (!Metadata.prototype.snapshot) {
    Metadata.prototype.snapshot = function metadataSnapshot(options) {
      return snapshot(this, options);
    };
  }

  if (!Object.getOwnPropertyDescriptor(Client.prototype, 'catalog')) {
    Object.defineProperty(Client.prototype, 'catalog', {
      enumerable: true,
      configurable: false,
      get: function catalog() { return this.metadata; }
    });
  }

  if (!Client.prototype.introspect) {
    Client.prototype.introspect = function introspect(options) {
      return this.metadata.snapshot(options);
    };
  }
}

exports.install = install;
exports.snapshot = snapshot;
exports.normalizeOptions = normalizeOptions;
