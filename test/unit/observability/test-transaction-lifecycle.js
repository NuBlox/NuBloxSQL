'use strict';

var assert = require('assert');
var Diagnostics = require('diagnostics_channel');
var path = require('path');

var PromiseTransaction = require(path.resolve(__dirname, '../../../lib/PromiseTransaction'));

var starts = [];
var ends = [];
var errors = [];
var startChannel = Diagnostics.channel('nublox.mysql.query.start');
var endChannel = Diagnostics.channel('nublox.mysql.query.end');
var errorChannel = Diagnostics.channel('nublox.mysql.query.error');

function onStart(message) {
  if (message.operation === 'transaction') {
    starts.push(message);
  }
}

function onEnd(message) {
  if (message.operation === 'transaction') {
    ends.push(message);
  }
}

function onError(message) {
  if (message.operation === 'transaction') {
    errors.push(message);
  }
}

startChannel.subscribe(onStart);
endChannel.subscribe(onEnd);
errorChannel.subscribe(onError);

var successful = createConnection(91);
var attempts = 0;

PromiseTransaction.run(successful, function () {
  attempts++;

  if (attempts === 1) {
    var error = new Error('deadlock');
    error.code = 'ER_LOCK_DEADLOCK';
    error.errno = 1213;
    return global.Promise.reject(error);
  }

  return 'committed';
}, {
  isolationLevel : 'read committed',
  maxRetries     : 1,
  readOnly       : true,
  retryDelayMs   : 0
})
  .then(function (value) {
    assert.strictEqual(value, 'committed');
    assert.strictEqual(starts.length, 1);
    assert.strictEqual(ends.length, 1);
    assert.strictEqual(errors.length, 0);
    assert.strictEqual(starts[0].threadId, 91);
    assert.strictEqual(starts[0].isolationLevel, 'READ COMMITTED');
    assert.strictEqual(starts[0].readOnly, true);
    assert.strictEqual(starts[0].maxRetries, 1);
    assert.strictEqual(ends[0].threadId, 91);
    assert.strictEqual(ends[0].attempts, 2);
    assert.strictEqual(ends[0].durationMs, undefined);

    var failed = createConnection(92);

    return PromiseTransaction.run(failed, function () {
      var error = new Error('duplicate');
      error.code = 'ER_DUP_ENTRY';
      error.errno = 1062;
      return global.Promise.reject(error);
    });
  })
  .then(function () {
    assert.fail('failed transaction should reject');
  }, function (error) {
    assert.strictEqual(error.code, 'ER_DUP_ENTRY');
    assert.strictEqual(starts.length, 2);
    assert.strictEqual(ends.length, 1);
    assert.strictEqual(errors.length, 1);
    assert.strictEqual(errors[0].threadId, 92);
    assert.strictEqual(errors[0].attempts, 1);
    assert.strictEqual(errors[0].errorCode, 'ER_DUP_ENTRY');
    assert.strictEqual(errors[0].errno, 1062);
    assert.strictEqual(errors[0].durationMs, undefined);
  })
  .then(cleanup, function (error) {
    cleanup();
    throw error;
  })
  .catch(function (error) {
    process.nextTick(function () {
      throw error;
    });
  });

function createConnection(threadId) {
  return {
    Promise  : global.Promise,
    threadId : threadId,
    query: function query() {
      return global.Promise.resolve([[], []]);
    },
    beginTransaction: function beginTransaction() {
      return global.Promise.resolve();
    },
    commit: function commit() {
      return global.Promise.resolve();
    },
    rollback: function rollback() {
      return global.Promise.resolve();
    }
  };
}

function cleanup() {
  startChannel.unsubscribe(onStart);
  endChannel.unsubscribe(onEnd);
  errorChannel.unsubscribe(onError);
}
