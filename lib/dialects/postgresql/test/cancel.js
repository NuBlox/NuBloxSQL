'use strict';

var assert = require('assert');
var postgres = require('..');
var cancellable = require('../lib/CancellableConnection');

async function main() {
  var key4 = Buffer.from([1, 2, 3, 4]);
  var request = postgres.protocol.encodeCancelRequest(12345, key4);
  assert.strictEqual(request.length, 16);
  assert.strictEqual(request.readUInt32BE(0), 16);
  assert.strictEqual(request.readUInt32BE(4), postgres.protocol.constants.CANCEL_REQUEST_CODE);
  assert.strictEqual(request.readUInt32BE(8), 12345);
  assert.deepStrictEqual(request.subarray(12), key4);

  var key32 = Buffer.alloc(32, 7);
  var request32 = postgres.protocol.encodeCancelRequest(42, key32);
  assert.strictEqual(request32.length, 44);
  assert.deepStrictEqual(request32.subarray(12), key32);

  assert.throws(function () { postgres.protocol.encodeCancelRequest(-1, key4); }, /processId/);
  assert.throws(function () { postgres.protocol.encodeCancelRequest(1, Buffer.alloc(3)); }, /4 to 256/);
  assert.throws(function () { postgres.protocol.encodeCancelRequest(1, Buffer.alloc(257)); }, /4 to 256/);

  assert.strictEqual(typeof postgres.PostgreSqlCancellationError, 'function');
  assert.strictEqual(postgres.capabilities.queryCancellation, true);
  var connection = postgres.createConnection({ user: 'test', ssl: false });
  assert.strictEqual(typeof connection.cancel, 'function');
  assert.strictEqual(connection.cancelGraceTimeout, 5000);

  var raceConnection = new cancellable.Connection({ user: 'test', ssl: false });
  var releaseCancel;
  var cancelPromise = new Promise(function (resolve) { releaseCancel = resolve; });
  var cancelReason = new Error('cancelled');
  var rejectedWith = null;
  var state = {
    kind: 'simple',
    rows: [],
    fields: [],
    command: '',
    rowCount: 0,
    error: null,
    cancelReason: cancelReason,
    cancelPromise: cancelPromise,
    cleanup: function () {},
    resolve: function () { throw new Error('cancelled operation must not resolve'); },
    reject: function (error) { rejectedWith = error; }
  };

  raceConnection._currentQuery = state;
  raceConnection._finishOperation(state);
  assert.strictEqual(raceConnection._currentQuery, state, 'cancelled operation must retain connection ownership until cancel dispatch settles');
  assert.strictEqual(state.finishPending, true);

  releaseCancel();
  await cancelPromise;
  await Promise.resolve();

  assert.strictEqual(raceConnection._currentQuery, null, 'operation should finish after cancel dispatch settles');
  assert.strictEqual(state.finishPending, false);
  assert.strictEqual(rejectedWith, cancelReason);

  console.log('ok - PostgreSQL CancelRequest contracts');
}

main().catch(function (error) {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
