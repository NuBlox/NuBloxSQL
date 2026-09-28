'use strict';

var assert = require('assert');
var control = require('../lib/OperationControl');
var mysql = require('..');

function testNormalizeDeadline() {
  var options = control.normalize({ timeout: 500, deadline: 1250 }, 'MySQL test', undefined, 1000);
  assert.strictEqual(options.timeout, 250);
  assert.strictEqual(options.deadline, 1250);

  options = control.normalize({ deadline: new Date(1400) }, 'MySQL test', undefined, 1000);
  assert.strictEqual(options.timeout, 400);
}

function testExpiredDeadline() {
  assert.throws(function () {
    control.normalize({ deadline: 999 }, 'MySQL test', undefined, 1000);
  }, function (error) {
    return error && error.code === 'NUBLOX_MYSQL_DEADLINE_EXCEEDED';
  });
}

function testTotalBudget() {
  var options = control.deriveTotalDeadline({ timeout: 300 }, 'MySQL pool query', 1000);
  assert.strictEqual(options.timeout, 300);
  assert.strictEqual(options.deadline, 1300);

  options = control.deriveTotalDeadline({ timeout: 500, deadline: 1200 }, 'MySQL pool query', 1000);
  assert.strictEqual(options.timeout, 200);
  assert.strictEqual(options.deadline, 1200);
}

function testAcquireInheritance() {
  var signal = { aborted: false };
  var options = control.acquisitionOptions({ signal: signal, deadline: 2000, acquire: { timeout: 50 } });
  assert.strictEqual(options.signal, signal);
  assert.strictEqual(options.deadline, 2000);
  assert.strictEqual(options.timeout, 50);
}

async function testPoolRejectsExpiredDeadline() {
  var pool = mysql.createPool({ user: 'test' });
  await assert.rejects(pool.getConnection({ deadline: Date.now() - 1 }), function (error) {
    return error && error.code === 'NUBLOX_MYSQL_DEADLINE_EXCEEDED';
  });
  await pool.end();
}

Promise.resolve()
  .then(testNormalizeDeadline)
  .then(testExpiredDeadline)
  .then(testTotalBudget)
  .then(testAcquireInheritance)
  .then(testPoolRejectsExpiredDeadline)
  .then(function () { console.log('ok - clean-room deadline/cancellation contract'); })
  .catch(function (error) {
    console.error(error.stack || error);
    process.exitCode = 1;
  });
