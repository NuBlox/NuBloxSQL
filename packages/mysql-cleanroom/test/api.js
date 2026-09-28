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
  assert.strictEqual(typeof mysql.MySqlError, 'function');
  assert.ok(mysql.protocol && typeof mysql.protocol === 'object');

  var connection = mysql.createConnection({ user: 'test' });
  assert.ok(connection instanceof mysql.Connection);
  assert.strictEqual(typeof connection.connect, 'function');
  assert.strictEqual(typeof connection.query, 'function');
  assert.strictEqual(typeof connection.prepare, 'function');
  assert.strictEqual(typeof connection.beginTransaction, 'function');
  assert.strictEqual(typeof connection.withTransaction, 'function');
  assert.strictEqual(typeof connection.savepoint, 'function');
  assert.strictEqual(typeof connection.end, 'function');

  var pool = mysql.createPool({ user: 'test' });
  assert.ok(pool instanceof mysql.Pool);
  assert.strictEqual(typeof pool.getConnection, 'function');
  assert.strictEqual(typeof pool.releaseConnection, 'function');
  assert.strictEqual(typeof pool.query, 'function');
  assert.strictEqual(typeof pool.execute, 'function');
  assert.strictEqual(typeof pool.withTransaction, 'function');
  assert.strictEqual(typeof pool.end, 'function');
  return pool.end();
}

function testDeclarationSurface() {
  var packageJson = require('../package.json');
  assert.strictEqual(packageJson.types, 'index.d.ts');
  assert.deepStrictEqual(packageJson.files, ['index.js', 'index.d.ts', 'lib/']);
  assert.deepStrictEqual(packageJson.dependencies, undefined);
  assert.deepStrictEqual(packageJson.devDependencies, undefined);

  var declaration = fs.readFileSync(path.join(__dirname, '..', 'index.d.ts'), 'utf8');
  [
    'export interface ConnectionConfig',
    'export interface QueryResult',
    'export class Connection',
    'export class PreparedStatement',
    'export class Pool',
    'export function createConnection',
    'export function createPool'
  ].forEach(function (token) {
    assert.ok(declaration.indexOf(token) !== -1, 'missing declaration token: ' + token);
  });
}

Promise.resolve()
  .then(testRuntimeSurface)
  .then(testDeclarationSurface)
  .then(function () { console.log('ok - clean-room API contract'); })
  .catch(function (error) {
    console.error(error.stack || error);
    process.exitCode = 1;
  });
