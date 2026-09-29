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

  var connection = mysql.createConnection({ user: 'test' });
  assert.ok(connection instanceof mysql.Connection);
  ['connect','query','queryStream','prepare','resetSession','beginTransaction','withTransaction','savepoint','end'].forEach(function (name) {
    assert.strictEqual(typeof connection[name], 'function', 'missing connection method ' + name);
  });

  var pool = mysql.createPool({ user: 'test' });
  assert.ok(pool instanceof mysql.Pool);
  assert.strictEqual(pool.resetOnRelease, true);
  assert.strictEqual(pool.resettingCount, 0);
  ['getConnection','releaseConnection','query','queryStream','execute','withTransaction','end'].forEach(function (name) {
    assert.strictEqual(typeof pool[name], 'function', 'missing pool method ' + name);
  });
  return pool.end();
}

function testInternalModuleSurface() {
  var packageJson = require('../package.json');
  assert.strictEqual(packageJson.name, '@nublox/mysql');
  assert.strictEqual(packageJson.version, '1.0.0');
  assert.strictEqual(packageJson.private, true);
  assert.strictEqual(packageJson.types, 'types.d.ts');
  assert.strictEqual(packageJson.license, 'SEE LICENSE IN LICENSE');
  ['dependencies','devDependencies','optionalDependencies','peerDependencies'].forEach(function (key) {
    assert.strictEqual(packageJson[key], undefined, key + ' must be absent');
  });
  assert.ok(fs.readFileSync(path.join(__dirname, '..', 'LICENSE'), 'utf8').indexOf('NuBloxSQL Proprietary Software Licence') !== -1);

  var base = fs.readFileSync(path.join(__dirname, '..', 'index.d.ts'), 'utf8');
  var publicTypes = fs.readFileSync(path.join(__dirname, '..', 'types.d.ts'), 'utf8');
  [
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
  .then(testInternalModuleSurface)
  .then(function () { console.log('ok - internal MySQL runtime contract'); })
  .catch(function (error) {
    console.error(error.stack || error);
    process.exitCode = 1;
  });
