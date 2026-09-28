'use strict';

var assert = require('assert');
var Diagnostics = require('diagnostics_channel');
var path = require('path');

var Connection = require(path.resolve(__dirname, '../../../lib/Connection'));

var starts = [];
var ends = [];
var errors = [];
var startChannel = Diagnostics.channel('nublox.mysql.query.start');
var endChannel = Diagnostics.channel('nublox.mysql.query.end');
var errorChannel = Diagnostics.channel('nublox.mysql.query.error');

function onStart(message) {
  if (message.operation === 'connect') {
    starts.push(message);
  }
}

function onEnd(message) {
  if (message.operation === 'connect') {
    ends.push(message);
  }
}

function onError(message) {
  if (message.operation === 'connect') {
    errors.push(message);
  }
}

startChannel.subscribe(onStart);
endChannel.subscribe(onEnd);
errorChannel.subscribe(onError);

try {
  var successful = createConnection();
  successful._startConnectTelemetry();
  successful.threadId = 41;
  successful._finishConnectTelemetry();
  successful._finishConnectTelemetry();

  assert.strictEqual(starts.length, 1);
  assert.strictEqual(ends.length, 1);
  assert.strictEqual(errors.length, 0);
  assert.strictEqual(starts[0].threadId, null);
  assert.strictEqual(ends[0].threadId, 41);
  assert.ok(starts[0].correlationId);
  assert.strictEqual(ends[0].correlationId, starts[0].correlationId);
  assert.ok(Number.isFinite(ends[0].durationMs));
  assert.ok(ends[0].durationMs >= 0);

  var failed = createConnection();
  failed._startConnectTelemetry();
  var error = new Error('connect timeout');
  error.code = 'ETIMEDOUT';
  error.errorno = 'ETIMEDOUT';
  failed._finishConnectTelemetry(error);

  assert.strictEqual(starts.length, 2);
  assert.strictEqual(ends.length, 1);
  assert.strictEqual(errors.length, 1);
  assert.strictEqual(errors[0].errorCode, 'ETIMEDOUT');
  assert.strictEqual(errors[0].errno, 'ETIMEDOUT');
  assert.strictEqual(errors[0].correlationId, starts[1].correlationId);
  assert.ok(Number.isFinite(errors[0].durationMs));
} finally {
  startChannel.unsubscribe(onStart);
  endChannel.unsubscribe(onEnd);
  errorChannel.unsubscribe(onError);
}

function createConnection() {
  return new Connection({
    config : {},
    socket : null
  });
}
