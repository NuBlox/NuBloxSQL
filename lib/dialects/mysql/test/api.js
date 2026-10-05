'use strict';

var assert = require('assert');
var fs = require('fs');
var path = require('path');
var mysql = require('..');

function testRuntimeSurface() {
  assert.strictEqual(typeof mysql.createConnection, 'function');
  assert.strictEqual(typeof mysql.createPool, 'function');
  assert.strictEqual(typeof mysql.Connection, 'function');
  assert.strictEqual(typeof mysql.Pool, 'function');
  assert.strictEqual(typeof mysql.PreparedStatement, 'function');
  assert.strictEqual(typeof mysql.ResultStream, 'function');
  assert.strictEqual(typeof mysql.MySqlError, 'function');
  assert.strictEqual(typeof mysql.MySqlClientError, 'function');
  assert.strictEqual(typeof mysql.MySqlResultLimitError, 'function');
  assert.ok(mysql.ERROR_CODES && mysql.ERROR_CODES.TIMEOUT);
  assert.ok(mysql.OBSERVABILITY_CHANNELS && mysql.OBSERVABILITY_CHANNELS.connection);
  assert.ok(mysql.protocol && typeof mysql.protocol === 'object');
  assert.strictEqual(typeof mysql.protocol.encodeResetConnection, 'function');
  assert.strictEqual(typeof mysql.protocol.encodeConnectionAttributes, 'function');
  assert.strictEqual(mysql.MAX_CONNECTION_ATTRIBUTES_BYTES, 64 * 1024);

  var connection = mysql.createConnection({ user: 'test' });
  assert.ok(connection instanceof mysql.Connection);
  ['connect','query','queryStream','prepare','resetSession','beginTransaction','withTransaction','savepoint','end'].forEach(function (name) {
    assert.strictEqual(typeof connection[name], 'function', 'missing connection method ' + name);
  });

  assert.strictEqual(connection.connectionAttributes._client_name, 'nubloxsql');
  assert.strictEqual(connection.connectionAttributes.program_name, 'nubloxsql');
  assert.ok(connection.connectionAttributes._client_version);

  var attributed = mysql.createConnection({
    user: 'test',
    connectionAttributes: { application: 'NuBloxSQL', worker: 7, trace_enabled: true }
  });
  assert.strictEqual(attributed.connectionAttributes.application, 'NuBloxSQL');
  assert.strictEqual(attributed.connectionAttributes.worker, '7');
  assert.strictEqual(attributed.connectionAttributes.trace_enabled, 'true');

  var disabled = mysql.createConnection({ user: 'test', connectionAttributes: false });
  assert.strictEqual(disabled.connectionAttributes, null);
  assert.throws(function () {
    mysql.createConnection({ user: 'test', connectionAttributes: { _reserved: 'no' } });
  }, /cannot begin with/);
  assert.throws(function () {
    mysql.createConnection({ user: 'test', connectionAttributes: { invalid: { nested: true } } });
  }, /strings, numbers, bigints, or booleans/);

  var pool = mysql.createPool({ user: 'test' });
  assert.ok(pool instanceof mysql.Pool);
  assert.strictEqual(pool.resetOnRelease, true);
  assert.strictEqual(pool.resettingCount, 0);
  ['getConnection','releaseConnection','query','queryStream','execute','withTransaction','end'].forEach(function (name) {
    assert.strictEqual(typeof pool[name], 'function', 'missing pool method ' + name);
  });
  return pool.end();
}

function testDeclarationSurface() {
  var base = fs.readFileSync(path.join(__dirname, '..', 'index.d.ts'), 'utf8');
  var publicTypes = fs.readFileSync(path.join(__dirname, '..', 'types.d.ts'), 'utf8');
  [
    'export type ConnectionAttributeValue',
    'connectionAttributes?: boolean | ConnectionAttributes',
    'export interface ConnectionConfig',
    'deadline?: number | Date',
    'export interface QueryResult',
    'export class Connection',
    'resetSession(options?: OperationOptions)',
    'export class PreparedStatement',
    'reset(options?: OperationOptions)',
    'export class Pool'
  ].forEach(function (token) { assert.ok(base.indexOf(token) !== -1, 'missing base declaration token: ' + token); });
  ['export class MySqlClientError', 'export const ERROR_CODES', 'export const OBSERVABILITY_CHANNELS'].forEach(function (token) {
    assert.ok(publicTypes.indexOf(token) !== -1, 'missing public declaration token: ' + token);
  });
}

Promise.resolve()
  .then(testRuntimeSurface)
  .then(testDeclarationSurface)
  .then(function () { console.log('ok - MySQL runtime contract'); })
  .catch(function (error) {
    console.error(error.stack || error);
    process.exitCode = 1;
  });
