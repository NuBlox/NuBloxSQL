'use strict';

var assert = require('assert');
var mysql = require('..');

async function main() {
  assert.deepStrictEqual(Array.from(mysql.protocol.encodeResetConnection()), [0x1f]);

  var connection = mysql.createConnection({ user: 'test' });
  var resetEvents = 0;
  connection.on('reset', function () { resetEvents++; });
  connection.inTransaction = true;
  connection._startOperation = function (kind, state, payload) {
    assert.strictEqual(kind, 'session-reset');
    assert.strictEqual(state.phase, 'start');
    assert.deepStrictEqual(Array.from(payload), [0x1f]);
    return Promise.resolve({ rows: [], fields: [], affectedRows: 0, insertId: 0, serverStatus: 2, warningCount: 0 });
  };

  var result = await connection.resetSession();
  assert.strictEqual(result.serverStatus, 2);
  assert.strictEqual(connection.inTransaction, false);
  assert.strictEqual(resetEvents, 1);

  console.log('ok - clean-room session reset contract');
}

main().catch(function (error) {
  console.error(error.stack || error);
  process.exitCode = 1;
});
