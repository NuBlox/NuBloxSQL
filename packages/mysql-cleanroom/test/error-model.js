'use strict';

var assert = require('assert');
var mysql = require('..');

async function capture(promise) {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('Expected operation to reject');
}

async function testConnectionNotReadyCode() {
  var connection = mysql.createConnection({ user: 'test' });
  var error = await capture(connection.query('SELECT 1'));
  assert.ok(error instanceof mysql.MySqlClientError);
  assert.strictEqual(error.code, mysql.ERROR_CODES.CONNECTION_NOT_READY);
  assert.strictEqual(error.category, 'connection');
  assert.strictEqual(error.retryable, false);
  assert.strictEqual(error.sqlState, null);
  assert.ok(error.cause instanceof Error);
}

async function testCustomAbortReasonIsNormalized() {
  var controller = new AbortController();
  controller.abort(new Error('custom caller reason'));
  var pool = mysql.createPool({ user: 'test' });
  var error = await capture(pool.getConnection({ signal: controller.signal }));
  assert.ok(error instanceof mysql.MySqlClientError);
  assert.strictEqual(error.code, mysql.ERROR_CODES.POOL_ACQUIRE_ABORTED);
  assert.strictEqual(error.category, 'cancelled');
  assert.strictEqual(error.retryable, false);
  assert.strictEqual(error.cause.message, 'custom caller reason');
  await pool.end();
}

async function testPoolEndedCode() {
  var pool = mysql.createPool({ user: 'test' });
  await pool.end();
  var error = await capture(pool.getConnection());
  assert.ok(error instanceof mysql.MySqlClientError);
  assert.strictEqual(error.code, mysql.ERROR_CODES.POOL_ENDED);
  assert.strictEqual(error.category, 'connection');
}

function testNativeServerErrorIsPreserved() {
  var native = new mysql.MySqlError('server rejected query', { code: 1064, sqlState: '42000' });
  var normalized = require('../lib/ErrorModel').classify(native, 'query', false);
  assert.strictEqual(normalized, native);
  assert.strictEqual(normalized.code, 1064);
  assert.strictEqual(normalized.sqlState, '42000');
}

function testResultLimitErrorIsPreserved() {
  var limit = new mysql.MySqlResultLimitError('too large', { code: 'NUBLOX_MYSQL_MAX_ROWS', limit: 1, observed: 2 });
  var normalized = require('../lib/ErrorModel').classify(limit, 'query', false);
  assert.strictEqual(normalized, limit);
}

function testErrorCodeRegistryIsFrozen() {
  assert.strictEqual(Object.isFrozen(mysql.ERROR_CODES), true);
  assert.strictEqual(mysql.ERROR_CODES.TIMEOUT, 'NUBLOX_MYSQL_TIMEOUT');
  assert.strictEqual(mysql.ERROR_CODES.ABORTED, 'NUBLOX_MYSQL_ABORTED');
  assert.strictEqual(mysql.ERROR_CODES.TRANSACTION_STATE, 'NUBLOX_MYSQL_TRANSACTION_STATE');
}

Promise.resolve()
  .then(testConnectionNotReadyCode)
  .then(testCustomAbortReasonIsNormalized)
  .then(testPoolEndedCode)
  .then(testNativeServerErrorIsPreserved)
  .then(testResultLimitErrorIsPreserved)
  .then(testErrorCodeRegistryIsFrozen)
  .then(function () { console.log('ok - clean-room error-model contract'); })
  .catch(function (error) {
    console.error(error.stack || error);
    process.exitCode = 1;
  });
