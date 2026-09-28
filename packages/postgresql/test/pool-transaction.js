'use strict';

var assert = require('assert');
var postgres = require('..');

assert.strictEqual(postgres.capabilities.savepoints, true);
assert.strictEqual(typeof postgres.Pool, 'function');
assert.strictEqual(typeof postgres.createPool, 'function');

var pool = postgres.createPool({ user: 'test', ssl: false, connectionLimit: 2, maxIdle: 1, idleTimeout: 0 });
assert.ok(pool instanceof postgres.Pool);
assert.strictEqual(pool.connectionLimit, 2);
assert.strictEqual(pool.maxIdle, 1);
assert.strictEqual(pool.totalCount, 0);
assert.strictEqual(pool.borrowedCount, 0);
assert.strictEqual(pool.waitingCount, 0);
assert.strictEqual(pool.resettingCount, 0);

assert.throws(function () { postgres.createPool({ user: 'test', connectionLimit: 0 }); }, /connectionLimit/);
assert.throws(function () { postgres.createPool({ user: 'test', queueLimit: -1 }); }, /queueLimit/);

async function transactionSqlContract() {
  var connection = postgres.createConnection({ user: 'test', ssl: false });
  var commands = [];
  connection.connected = true;
  connection.ended = false;
  connection.transactionStatus = 'I';
  connection.query = async function (sql) {
    commands.push(sql);
    if (/^BEGIN/.test(sql)) this.transactionStatus = 'T';
    else if (sql === 'COMMIT' || sql === 'ROLLBACK') this.transactionStatus = 'I';
    return { rows: [], fields: [], command: sql, rowCount: null };
  };

  await connection.beginTransaction({ isolationLevel: 'serializable', readOnly: true, deferrable: true });
  assert.strictEqual(commands[0], 'BEGIN ISOLATION LEVEL SERIALIZABLE READ ONLY DEFERRABLE');
  await connection.savepoint('checkpoint');
  await connection.rollbackToSavepoint('checkpoint');
  await connection.releaseSavepoint('checkpoint');
  await connection.commit();
  assert.deepStrictEqual(commands.slice(1), [
    'SAVEPOINT "checkpoint"',
    'ROLLBACK TO SAVEPOINT "checkpoint"',
    'RELEASE SAVEPOINT "checkpoint"',
    'COMMIT'
  ]);

  connection.transactionStatus = 'I';
  commands.length = 0;
  await assert.rejects(connection.withTransaction(async function () {
    throw new Error('application failure');
  }), /application failure/);
  assert.deepStrictEqual(commands, ['BEGIN', 'ROLLBACK']);

  connection.transactionStatus = 'I';
  commands.length = 0;
  await connection.resetSession();
  assert.deepStrictEqual(commands, ['DISCARD ALL']);
}

Promise.resolve()
  .then(transactionSqlContract)
  .then(function () { return pool.end(); })
  .then(function () { console.log('ok - PostgreSQL pool/transaction contracts'); })
  .catch(function (error) {
    console.error(error && error.stack || error);
    process.exitCode = 1;
  });
