'use strict';

var LIMIT_KEYS = Object.freeze(['length','sqlLength','column','exprDepth','compoundSelect','vdbeOp','functionArg','attach','likePatternLength','variableNumber','triggerDepth']);
var HARDENED_LIMITS = Object.freeze({
  length: 8 * 1024 * 1024,
  sqlLength: 1024 * 1024,
  column: 512,
  exprDepth: 250,
  compoundSelect: 100,
  vdbeOp: 250000,
  functionArg: 64,
  attach: 4,
  likePatternLength: 5000,
  variableNumber: 10000,
  triggerDepth: 64
});
var HARDENED_QUERY_BUDGET = Object.freeze({ maxRows: 10000, maxRowBytes: 1024 * 1024, maxResultBytes: 16 * 1024 * 1024 });

function validateLimit(name, value) {
  if (LIMIT_KEYS.indexOf(name) === -1) throw new RangeError('Unknown SQLite runtime limit: ' + name);
  if (value !== Infinity && (!Number.isInteger(value) || value < 0)) throw new RangeError('SQLite runtime limit ' + name + ' must be a non-negative integer or Infinity');
}
function freezeLimits(source) {
  var out = {};
  LIMIT_KEYS.forEach(function (key) { if (source && source[key] !== undefined) out[key] = source[key]; });
  return Object.freeze(out);
}
function queryBudget(options) {
  options = options || {};
  var base = options.profile === 'hardened' ? HARDENED_QUERY_BUDGET : {};
  var out = {};
  ['maxRows','maxRowBytes','maxResultBytes'].forEach(function (key) {
    var value = options[key] !== undefined ? options[key] : base[key];
    if (value !== undefined) {
      if (!Number.isInteger(value) || value < 0) throw new RangeError('SQLite ' + key + ' must be a non-negative integer');
      out[key] = value;
    }
  });
  return Object.freeze(out);
}

function install(runtime) {
  var proto = runtime.Connection.prototype;
  if (proto.__nubloxResourceGovernanceInstalled) return;
  Object.defineProperty(proto, '__nubloxResourceGovernanceInstalled', { value: true, enumerable: false });

  proto.resourceGovernanceCapabilities = function resourceGovernanceCapabilities() {
    this._assertOpen();
    return Object.freeze({
      mutableRuntimeLimits: !!(this._database && this._database.limits && typeof this._database.limits === 'object'),
      pageCountLimit: true,
      queryResultBudgets: true,
      hardenedProfile: true
    });
  };
  proto.runtimeLimits = function runtimeLimits() {
    this._assertOpen();
    if (!this._database.limits || typeof this._database.limits !== 'object') return Object.freeze({});
    return freezeLimits(this._database.limits);
  };
  proto.setRuntimeLimit = function setRuntimeLimit(name, value) {
    this._assertOpen();
    validateLimit(name, value);
    if (!this._database.limits || typeof this._database.limits !== 'object') throw runtime.unsupported('mutable SQLite runtime limits');
    try { this._database.limits[name] = value; return this._database.limits[name]; }
    catch (error) { throw runtime.wrapError(error); }
  };
  proto.applyRuntimeLimits = function applyRuntimeLimits(limits) {
    this._assertOpen();
    if (!limits || typeof limits !== 'object' || Array.isArray(limits)) throw new TypeError('SQLite runtime limits must be an object');
    var self = this;
    Object.keys(limits).forEach(function (name) { self.setRuntimeLimit(name, limits[name]); });
    return this.runtimeLimits();
  };
  proto.pageCountLimit = function pageCountLimit(value, database) {
    this._assertOpen();
    database = database || 'main';
    if (typeof database !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(database)) throw new TypeError('SQLite database name must be a simple SQL identifier');
    if (value !== undefined && (!Number.isInteger(value) || value < 1)) throw new RangeError('SQLite max page count must be a positive integer');
    try {
      if (value !== undefined) this._database.exec('PRAGMA "' + database.replace(/"/g, '""') + '".max_page_count = ' + value);
      var row = this._database.prepare('PRAGMA "' + database.replace(/"/g, '""') + '".max_page_count').get();
      return Number(row[Object.keys(row)[0]]);
    } catch (error) { throw runtime.wrapError(error); }
  };
  proto.queryBudget = function queryBudgetForConnection(options) { return queryBudget(options); };
  proto.governedQuery = function governedQuery(sql, parameters, options) {
    options = options || {};
    var budget = queryBudget(options);
    var queryOptions = Object.assign({}, options, budget);
    delete queryOptions.profile;
    return this.query(sql, parameters, queryOptions);
  };
  proto.applyHardenedProfile = function applyHardenedProfile(options) {
    this._assertOpen();
    options = options || {};
    var mutable = !!(this._database.limits && typeof this._database.limits === 'object');
    var appliedLimits = Object.freeze({});
    if (mutable) appliedLimits = this.applyRuntimeLimits(Object.assign({}, HARDENED_LIMITS, options.limits || {}));
    var maxPageCount = options.maxPageCount === undefined ? null : this.pageCountLimit(options.maxPageCount, options.database || 'main');
    return Object.freeze({
      profile: 'hardened',
      mutableRuntimeLimits: mutable,
      limits: appliedLimits,
      queryBudget: queryBudget(Object.assign({ profile: 'hardened' }, options.queryBudget || {})),
      maxPageCount: maxPageCount
    });
  };
}

exports.LIMIT_KEYS = LIMIT_KEYS;
exports.HARDENED_LIMITS = HARDENED_LIMITS;
exports.HARDENED_QUERY_BUDGET = HARDENED_QUERY_BUDGET;
exports.install = install;
exports.freezeLimits = freezeLimits;
exports.validateLimit = validateLimit;
