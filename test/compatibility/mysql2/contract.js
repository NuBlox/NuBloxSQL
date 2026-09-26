'use strict';

var assert = require('assert');
var path = require('path');

var mysql2 = require('mysql2');
var mysql2Promise = require('mysql2/promise');
var nublox = require(path.resolve(__dirname, '../../..'));
var nubloxPromise = require(path.resolve(__dirname, '../../../promise'));

var callbackFunctions = [
  'createConnection',
  'createPool',
  'createPoolCluster',
  'escape',
  'escapeId',
  'format',
  'raw'
];
var promiseFunctions = [
  'createConnection',
  'createPool',
  'escape',
  'escapeId',
  'format',
  'raw'
];
var formatCases = [
  {
    sql    : 'SELECT ? AS value',
    values : [42]
  },
  {
    sql    : 'SELECT ? AS value',
    values : ['NuBloxSQL']
  },
  {
    sql    : 'SELECT ?? FROM ?? WHERE id = ?',
    values : ['name', 'users', 7]
  },
  {
    sql    : 'INSERT INTO ?? SET ?',
    values : ['users', {active: true, name: 'Stephen'}]
  }
];

callbackFunctions.forEach(function (name) {
  assert.strictEqual(typeof mysql2[name], 'function', 'mysql2 callback export missing: ' + name);
  assert.strictEqual(typeof nublox[name], 'function', 'NuBlox callback export missing: ' + name);
});

promiseFunctions.forEach(function (name) {
  assert.strictEqual(typeof mysql2Promise[name], 'function', 'mysql2 promise export missing: ' + name);
  assert.strictEqual(typeof nubloxPromise[name], 'function', 'NuBlox promise export missing: ' + name);
});

formatCases.forEach(function (testCase) {
  assert.strictEqual(
    nublox.format(testCase.sql, testCase.values),
    mysql2.format(testCase.sql, testCase.values),
    'format parity failed for: ' + testCase.sql
  );
});

assert.strictEqual(nublox.escape(null), mysql2.escape(null));
assert.strictEqual(nublox.escape(true), mysql2.escape(true));
assert.strictEqual(nublox.escape(false), mysql2.escape(false));
assert.strictEqual(nublox.escape("O'Reilly"), mysql2.escape("O'Reilly"));
assert.strictEqual(nublox.escapeId('schema.table'), mysql2.escapeId('schema.table'));
assert.strictEqual(typeof nublox.PromiseConnection, 'function');
assert.strictEqual(typeof nublox.PromisePool, 'function');
assert.strictEqual(typeof nublox.Types, 'object');

assert.strictEqual(typeof nublox.PromiseConnection.prototype.query, 'function');
assert.strictEqual(typeof nublox.PromiseConnection.prototype.beginTransaction, 'function');
assert.strictEqual(typeof nublox.PromiseConnection.prototype.commit, 'function');
assert.strictEqual(typeof nublox.PromiseConnection.prototype.rollback, 'function');
assert.strictEqual(typeof nublox.PromiseConnection.prototype.end, 'function');
assert.strictEqual(typeof nublox.PromisePool.prototype.query, 'function');
assert.strictEqual(typeof nublox.PromisePool.prototype.getConnection, 'function');
assert.strictEqual(typeof nublox.PromisePool.prototype.end, 'function');

assert.strictEqual(typeof nublox.PromiseConnection.prototype.iterate, 'function');
assert.strictEqual(typeof nublox.PromiseConnection.prototype.withTransaction, 'function');
assert.strictEqual(typeof nublox.PromisePool.prototype.healthCheck, 'function');
assert.strictEqual(typeof nublox.PromisePool.prototype.stats, 'function');

var callbackConnection = nublox.createConnection({host: '127.0.0.1'});
var callbackPool = nublox.createPool({host: '127.0.0.1'});
var promiseConnection = callbackConnection.promise();
var promisePool = callbackPool.promise();

assert.strictEqual(typeof callbackConnection.execute, 'function');
assert.strictEqual(typeof callbackPool.execute, 'function');
assert.strictEqual(typeof promiseConnection.execute, 'function');
assert.strictEqual(typeof promisePool.execute, 'function');
assert.strictEqual(typeof nublox.PromiseConnection.prototype.execute, 'function');

callbackConnection.destroy();
callbackPool.end(function () {});
