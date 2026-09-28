'use strict';

var assert = require('assert');
var Diagnostics = require('diagnostics_channel');
var path = require('path');

var Execute = require(path.resolve(__dirname, '../../lib/protocol/sequences/Execute'));

var starts = [];
var ends = [];
var errors = [];
var startChannel = Diagnostics.channel('nublox.mysql.query.start');
var endChannel = Diagnostics.channel('nublox.mysql.query.end');
var errorChannel = Diagnostics.channel('nublox.mysql.query.error');

function onStart(message) {
  if (message.operation === 'execute') {
    starts.push(message);
  }
}

function onEnd(message) {
  if (message.operation === 'execute') {
    ends.push(message);
  }
}

function onError(message) {
  if (message.operation === 'execute') {
    errors.push(message);
  }
}

startChannel.subscribe(onStart);
endChannel.subscribe(onEnd);
errorChannel.subscribe(onError);

var successful = createExecute({
  id        : 7,
  sql       : 'SELECT 1',
  numParams : 0
}, []);

successful.start();
successful.end(null, [], []);
successful.end(null, [], []);

assert.strictEqual(starts.length, 1);
assert.strictEqual(ends.length, 1);
assert.strictEqual(errors.length, 0);
assert.strictEqual(starts[0].threadId, 101);
assert.strictEqual(starts[0].sql, 'SELECT 1');
assert.strictEqual(ends[0].threadId, 101);
assert.strictEqual(ends[0].sql, 'SELECT 1');
assert.ok(Number.isFinite(ends[0].durationMs));
assert.ok(ends[0].durationMs >= 0);

var failed = createExecute({
  id        : 8,
  sql       : 'SELECT ?',
  numParams : 1
}, []);

failed.start();

assert.strictEqual(starts.length, 2);
assert.strictEqual(ends.length, 1);
assert.strictEqual(errors.length, 1);
assert.strictEqual(errors[0].threadId, 101);
assert.strictEqual(errors[0].sql, 'SELECT ?');
assert.strictEqual(errors[0].errorCode, 'PREPARED_STATEMENT_PARAMETER_COUNT_MISMATCH');
assert.strictEqual(errors[0].aborted, false);
assert.ok(Number.isFinite(errors[0].durationMs));

cleanup();

function createExecute(statement, values) {
  var sequence = new Execute({
    statement : statement,
    values    : values
  }, function () {});

  sequence._connection = {threadId: 101};
  sequence.on('error', function () {});
  return sequence;
}

function cleanup() {
  startChannel.unsubscribe(onStart);
  endChannel.unsubscribe(onEnd);
  errorChannel.unsubscribe(onError);
}
