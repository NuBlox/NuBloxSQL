'use strict';

var assert = require('assert');
var nublox = require('..');
var control = require('../lib/client/OperationControl');

function testNormalization() {
  var client = { dialect: 'postgresql' };
  var signal = new AbortController().signal;
  var normalized = control.normalize(client, 'query', {
    timeout: 500,
    deadline: 1250,
    signal: signal,
    acquire: { timeout: 50 }
  }, 1000);

  assert.strictEqual(normalized.timeout, 250);
  assert.strictEqual(normalized.deadline, 1250);
  assert.strictEqual(normalized.signal, signal);
  assert.strictEqual(normalized.acquire.timeout, 50);
  assert.strictEqual(normalized.acquire.deadline, 1250);
  assert.strictEqual(normalized.acquire.signal, signal);
}

function testValidation() {
  var client = { dialect: 'mysql' };
  assert.throws(function () { control.normalize(client, 'query', { timeout: 0 }, 1000); }, RangeError);
  assert.throws(function () { control.normalize(client, 'query', { deadline: new Date('invalid') }, 1000); }, RangeError);
  assert.throws(function () { control.normalize(client, 'query', { signal: {} }, 1000); }, TypeError);
}

function testPortablePreflightErrors() {
  var mysql = nublox.createClient({ dialect: 'mysql', user: 'test', pool: false });
  assert.throws(function () {
    mysql.query('SELECT 1', { deadline: Date.now() - 1 });
  }, function (error) {
    return error instanceof nublox.NuBloxSqlError && error.category === 'timeout' && error.operation === 'query';
  });

  var controller = new AbortController();
  controller.abort(new Error('application cancellation'));
  assert.throws(function () {
    mysql.query('SELECT 1', { signal: controller.signal });
  }, function (error) {
    return error instanceof nublox.NuBloxSqlError && error.category === 'cancelled' && error.operation === 'query';
  });
}

async function testSqliteHonesty() {
  var sqlite = nublox.createClient({ dialect: 'sqlite', filename: ':memory:' });
  var result = await sqlite.query('SELECT 1 AS value');
  assert.strictEqual(result.rows[0].value, 1);

  assert.throws(function () {
    sqlite.query('SELECT 1', { timeout: 10 });
  }, function (error) {
    return error instanceof nublox.NuBloxSqlError && error.category === 'unsupported';
  });

  var controller = new AbortController();
  assert.throws(function () {
    sqlite.stream('SELECT 1', { signal: controller.signal });
  }, function (error) {
    return error instanceof nublox.NuBloxSqlError && error.category === 'unsupported';
  });

  await sqlite.close();
}

Promise.resolve()
  .then(testNormalization)
  .then(testValidation)
  .then(testPortablePreflightErrors)
  .then(testSqliteHonesty)
  .then(function () { console.log('NuBloxSQL portable operation control contract passed'); })
  .catch(function (error) {
    console.error(error.stack || error);
    process.exitCode = 1;
  });