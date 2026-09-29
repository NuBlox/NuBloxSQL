'use strict';

var assert = require('assert');
var postgres = require('..');

assert.strictEqual(postgres.capabilities.serverSideCursors, true);
assert.strictEqual(typeof postgres.PortalCursor, 'function');

async function cursorContract() {
  var connection = postgres.createConnection({ user: 'test', ssl: false });
  connection.transactionStatus = 'T';
  var statement = new postgres.PreparedStatement(connection, {
    name: 'stmt_cursor',
    sql: 'SELECT $1::int4',
    parameterTypeOids: [23],
    fields: []
  });

  assert.throws(function () { statement.openCursor([], { batchSize: 2 }); }, /expects 1 parameter/);
  assert.throws(function () { statement.openCursor([1], { batchSize: 0 }); }, /batchSize/);

  var cursor = statement.openCursor([1], { name: 'portal_test', batchSize: 2 });
  assert.ok(cursor instanceof postgres.PortalCursor);
  assert.strictEqual(cursor.name, 'portal_test');
  assert.strictEqual(cursor.batchSize, 2);
  await assert.rejects(statement.close(), /portal cursors are active/);

  var fetches = 0;
  connection._fetchPortal = async function () {
    fetches += 1;
    if (fetches === 1) return { rows: [{ n: 1 }, { n: 2 }], fields: [], done: false, command: '', rowCount: null };
    cursor.done = true;
    return { rows: [{ n: 3 }], fields: [], done: true, command: 'SELECT 3', rowCount: 3 };
  };
  connection._closePortal = async function () {};

  var first = await cursor.fetch();
  assert.deepStrictEqual(first.rows.map(function (row) { return row.n; }), [1, 2]);
  assert.strictEqual(first.done, false);
  var second = await cursor.fetch();
  assert.deepStrictEqual(second.rows.map(function (row) { return row.n; }), [3]);
  assert.strictEqual(second.done, true);
  await cursor.close();
  assert.strictEqual(cursor.closed, true);
  assert.strictEqual(statement._activeCursors, 0);

  connection.transactionStatus = 'I';
  assert.throws(function () { statement.openCursor([1]); }, /active transaction/);
}

async function earlyIteratorCleanup() {
  var connection = postgres.createConnection({ user: 'test', ssl: false });
  connection.transactionStatus = 'T';
  var statement = new postgres.PreparedStatement(connection, {
    name: 'stmt_iter',
    sql: 'SELECT 1',
    parameterTypeOids: [],
    fields: []
  });
  var cursor = statement.openCursor([], { batchSize: 2 });
  connection._fetchPortal = async function () {
    return { rows: [{ n: 1 }, { n: 2 }], fields: [], done: false, command: '', rowCount: null };
  };
  var closed = false;
  connection._closePortal = async function () { closed = true; };

  for await (var row of cursor) {
    assert.strictEqual(row.n, 1);
    break;
  }
  assert.strictEqual(closed, true);
  assert.strictEqual(cursor.closed, true);
  assert.strictEqual(statement._activeCursors, 0);
}

Promise.resolve()
  .then(cursorContract)
  .then(earlyIteratorCleanup)
  .then(function () { console.log('ok - PostgreSQL portal cursor contracts'); })
  .catch(function (error) {
    console.error(error && error.stack || error);
    process.exitCode = 1;
  });
