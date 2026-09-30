'use strict';

var path = require('path');
var sqliteModule = require('node:sqlite');

function simpleName(value, label) {
  if (typeof value !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) throw new TypeError('SQLite ' + label + ' must be a simple SQL identifier');
  return value;
}

function install(runtime) {
  if (!runtime || !runtime.Connection) throw new TypeError('SQLite extensibility integration requires runtime Connection');
  var proto = runtime.Connection.prototype;
  if (proto.__nubloxExtensibilityInstalled) return;
  Object.defineProperty(proto, '__nubloxExtensibilityInstalled', { value: true, enumerable: false });

  proto.extensibilityCapabilities = function extensibilityCapabilities() {
    this._assertOpen();
    return Object.freeze({
      scalarFunctions: typeof this._database.function === 'function',
      aggregates: typeof this._database.aggregate === 'function',
      extensionLoading: typeof this._database.loadExtension === 'function' && typeof this._database.enableLoadExtension === 'function',
      authorizer: typeof this._database.setAuthorizer === 'function',
      defensive: typeof this._database.enableDefensive === 'function'
    });
  };

  proto.createFunction = function createFunction(name, options, fn) {
    this._assertOpen();
    name = simpleName(name, 'function name');
    if (typeof options === 'function' && fn === undefined) { fn = options; options = {}; }
    options = options || {};
    if (typeof fn !== 'function') throw new TypeError('SQLite createFunction requires a JavaScript function');
    if (typeof this._database.function !== 'function') throw runtime.unsupported('user-defined scalar functions');
    try { this._database.function(name, options, fn); return Object.freeze({ name: name, kind: 'scalar' }); }
    catch (error) { throw runtime.wrapError(error); }
  };

  proto.createAggregate = function createAggregate(name, options) {
    this._assertOpen();
    name = simpleName(name, 'aggregate name');
    if (!options || typeof options !== 'object' || typeof options.step !== 'function') throw new TypeError('SQLite createAggregate requires options.step');
    if (typeof this._database.aggregate !== 'function') throw runtime.unsupported('user-defined aggregates');
    try { this._database.aggregate(name, options); return Object.freeze({ name: name, kind: 'aggregate' }); }
    catch (error) { throw runtime.wrapError(error); }
  };

  proto.enableExtensionLoading = function enableExtensionLoading(active) {
    this._assertOpen();
    if (typeof active !== 'boolean') throw new TypeError('SQLite enableExtensionLoading requires a boolean');
    if (!this._extensionPolicy.enabled) throw new runtime.SqliteError('SQLite extension loading was not enabled when the connection was created', { code: 'NUBLOXSQL_UNSUPPORTED', category: 'unsupported' });
    if (typeof this._database.enableLoadExtension !== 'function') throw runtime.unsupported('extension loading');
    try { this._database.enableLoadExtension(active); return active; }
    catch (error) { throw runtime.wrapError(error); }
  };

  proto.loadExtension = function loadExtension(filename, entryPoint) {
    this._assertOpen();
    if (!this._extensionPolicy.enabled) throw new runtime.SqliteError('SQLite extension loading is disabled by policy', { code: 'NUBLOXSQL_UNSUPPORTED', category: 'unsupported' });
    if (typeof filename !== 'string' || filename.length === 0) throw new TypeError('SQLite extension path must be a non-empty string');
    if (entryPoint !== undefined && (typeof entryPoint !== 'string' || entryPoint.length === 0)) throw new TypeError('SQLite extension entry point must be a non-empty string');
    if (typeof this._database.loadExtension !== 'function') throw runtime.unsupported('extension loading');
    var resolved = path.resolve(filename);
    if (this._extensionPolicy.allowlist.length && this._extensionPolicy.allowlist.indexOf(resolved) === -1) {
      throw new runtime.SqliteError('SQLite extension path is not permitted by extensionAllowlist', { code: 'NUBLOXSQL_UNSUPPORTED', category: 'authorization' });
    }
    try {
      if (entryPoint === undefined) this._database.loadExtension(resolved);
      else this._database.loadExtension(resolved, entryPoint);
      return Object.freeze({ path: resolved, entryPoint: entryPoint || null });
    } catch (error) { throw runtime.wrapError(error); }
  };

  proto.setAuthorizer = function setAuthorizer(callback) {
    this._assertOpen();
    if (callback !== null && typeof callback !== 'function') throw new TypeError('SQLite authorizer must be a function or null');
    if (typeof this._database.setAuthorizer !== 'function') throw runtime.unsupported('authorizer callbacks');
    try { this._database.setAuthorizer(callback); return callback !== null; }
    catch (error) { throw runtime.wrapError(error); }
  };

  proto.setDefensive = function setDefensive(active) {
    this._assertOpen();
    if (typeof active !== 'boolean') throw new TypeError('SQLite defensive mode requires a boolean');
    if (typeof this._database.enableDefensive !== 'function') throw runtime.unsupported('defensive mode');
    try { this._database.enableDefensive(active); return active; }
    catch (error) { throw runtime.wrapError(error); }
  };

  proto.authorizerConstants = function authorizerConstants() {
    var constants = sqliteModule.constants || {};
    var out = {};
    Object.keys(constants).forEach(function (key) {
      if (/^SQLITE_/.test(key)) out[key] = constants[key];
    });
    return Object.freeze(out);
  };

  proto.extensionPolicy = function extensionPolicy() { return this._extensionPolicy; };
}

exports.install = install;
