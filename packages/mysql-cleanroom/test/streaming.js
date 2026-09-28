'use strict';

var assert = require('assert');
var EventEmitter = require('events').EventEmitter;
var mysql = require('..');

function fakeSocket() {
  var socket = new EventEmitter();
  socket.destroyed = false;
  socket.writes = [];
  socket.pauseCount = 0;
  socket.resumeCount = 0;
  socket.write = function (buffer) { socket.writes.push(buffer); return true; };
  socket.pause = function () { socket.pauseCount++; return socket; };
  socket.resume = function () { socket.resumeCount++; return socket; };
  socket.destroy = function () { socket.destroyed = true; socket.emit('close'); };
  socket.end = function () { socket.destroyed = true; socket.emit('close'); };
  return socket;
}

function testDefaultLimits() {
  var connection = mysql.createConnection({ user: 'test' });
  assert.strictEqual(connection.maxRows, 100000);
  assert.strictEqual(connection.maxResultBytes, 64 * 1024 * 1024);
  assert.strictEqual(connection.maxRowBytes, 16 * 1024 * 1024);
  assert.strictEqual(connection.streamHighWaterMark, 16);
  assert.deepStrictEqual(mysql.DEFAULT_LIMITS, {
    maxRows: 100000,
    maxResultBytes: 64 * 1024 * 1024,
    maxRowBytes: 16 * 1024 * 1024,
    streamHighWaterMark: 16
  });
}

function testLimitErrors() {
  var connection = mysql.createConnection({ user: 'test', maxRows: 1, maxResultBytes: 8, maxRowBytes: 4 });
  var state = { rowCount: 0, resultBytes: 0, maxRows: 1, maxResultBytes: 8, maxRowBytes: 4 };
  assert.strictEqual(connection._limitPayload(Buffer.alloc(4), state), null);
  var bytesError = connection._limitPayload(Buffer.alloc(5), state);
  assert.ok(bytesError instanceof mysql.MySqlResultLimitError);
  assert.strictEqual(bytesError.code, 'NUBLOX_MYSQL_MAX_RESULT_BYTES');
  assert.strictEqual(bytesError.limit, 8);
  assert.strictEqual(bytesError.observed, 9);

  state.resultBytes = 0;
  var rowBytesError = connection._limitRow(Buffer.alloc(5), state);
  assert.strictEqual(rowBytesError.code, 'NUBLOX_MYSQL_MAX_ROW_BYTES');
  assert.strictEqual(connection._limitRow(Buffer.alloc(4), state), null);
  var rowsError = connection._limitRow(Buffer.alloc(4), state);
  assert.strictEqual(rowsError.code, 'NUBLOX_MYSQL_MAX_ROWS');
}

function testBackpressurePrimitive() {
  var socket = fakeSocket();
  var destroyed = null;
  var connection = {
    socket: socket,
    ended: false,
    _queryState: {},
    destroy: function (error) { destroyed = error || true; connection.ended = true; }
  };
  var stream = new mysql.ResultStream(connection, connection._queryState, { highWaterMark: 1 });
  stream._pushRow({ id: 1 }, 3);
  assert.strictEqual(socket.pauseCount, 1);
  stream._read();
  assert.strictEqual(socket.resumeCount, 1);
  stream.destroy();
  assert.ok(destroyed);
}

function testQueryStreamStartsProtocolOperation() {
  var connection = mysql.createConnection({ user: 'test', maxRows: 10, maxResultBytes: 1024, maxRowBytes: 128 });
  var socket = fakeSocket();
  connection.connected = true;
  connection.socket = socket;
  var stream = connection.queryStream('SELECT 1', { highWaterMark: 2 });
  assert.ok(stream instanceof mysql.ResultStream);
  assert.strictEqual(connection._queryState.kind, 'stream-query');
  assert.strictEqual(connection._queryState.maxRows, 10);
  assert.strictEqual(socket.writes.length, 1);
  assert.strictEqual(socket.writes[0][4], 0x03);
  stream.destroy();
}

function testInvalidLimitsFailEarly() {
  assert.throws(function () { mysql.createConnection({ user: 'test', maxRows: 0 }); }, /maxRows/);
  assert.throws(function () { mysql.createConnection({ user: 'test', maxResultBytes: -1 }); }, /maxResultBytes/);
  assert.throws(function () { mysql.createConnection({ user: 'test', streamHighWaterMark: 0 }); }, /streamHighWaterMark/);
}

Promise.resolve()
  .then(testDefaultLimits)
  .then(testLimitErrors)
  .then(testBackpressurePrimitive)
  .then(testQueryStreamStartsProtocolOperation)
  .then(testInvalidLimitsFailEarly)
  .then(function () { console.log('ok - clean-room streaming/resource-limit contract'); })
  .catch(function (error) {
    console.error(error.stack || error);
    process.exitCode = 1;
  });
