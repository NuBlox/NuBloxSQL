'use strict';

var assert = require('assert');
var nublox = require('..');
var sql = nublox.sql;

async function main() {
  assert.deepStrictEqual(Array.from(nublox.TRANSACTION_ISOLATION_LEVELS), ['read-uncommitted','read-committed','repeatable-read','serializable']);
  assert.deepStrictEqual(Array.from(nublox.SQLITE_TRANSACTION_MODES), ['deferred','immediate','exclusive']);

  var mysql = nublox.transactionPolicy('mysql');
  assert.strictEqual(mysql.transactions, true);
  assert.strictEqual(mysql.readOnly, true);
  assert.strictEqual(mysql.deferrable, false);
  assert.strictEqual(mysql.nestedTransactions, true);
  assert.deepStrictEqual(Array.from(mysql.isolationLevels), Array.from(nublox.TRANSACTION_ISOLATION_LEVELS));

  var pg = nublox.transactionPolicy('postgresql');
  assert.strictEqual(pg.deferrable, true);
  assert.strictEqual(pg.readOnly, true);

  var sqlserver = nublox.transactionPolicy('sqlserver');
  assert.strictEqual(sqlserver.readOnly, false);
  assert.strictEqual(sqlserver.deferrable, false);

  var sqlite = nublox.transactionPolicy('sqlite');
  assert.strictEqual(sqlite.transactions, true);
  assert.deepStrictEqual(Array.from(sqlite.isolationLevels), []);
  assert.deepStrictEqual(Array.from(sqlite.sqliteModes), ['deferred','immediate','exclusive']);
  assert.strictEqual(sqlite.retries.requiresRollbackBeforeRetry, true);
  assert.strictEqual(sqlite.retries.nested, false);
  assert.strictEqual(sqlite.guarantees.callbackFailureRollback, true);

  var db = nublox.createClient({ dialect: 'sqlite', filename: ':memory:' });
  try {
    assert.deepStrictEqual(db.transactionPolicy(), sqlite);
    await db.execute(sql`CREATE TABLE tx_policy (id INTEGER PRIMARY KEY, value TEXT)`);

    var retryEvents = [];
    var attempts = 0;
    await db.transaction(async function (tx) {
      attempts += 1;
      assert.strictEqual(tx.transactionAttempt, attempts);
      if (attempts === 1) {
        await tx.execute(sql`INSERT INTO tx_policy (id, value) VALUES (${1}, ${'rolled-back'})`);
        var error = new Error('serialization retry');
        error.category = 'serialization';
        throw error;
      }
      await tx.execute(sql`INSERT INTO tx_policy (id, value) VALUES (${2}, ${'committed'})`);
    }, {
      retry: {
        maxAttempts: 2,
        delayMs: 0,
        onRetry: function (error, completedAttempt, nextAttempt) {
          retryEvents.push([error.message, completedAttempt, nextAttempt]);
        }
      }
    });

    assert.strictEqual(attempts, 2);
    assert.deepStrictEqual(retryEvents, [['serialization retry', 1, 2]]);
    assert.deepStrictEqual((await db.all(sql`SELECT id FROM tx_policy ORDER BY id`)).map(function (row) { return Number(row.id); }), [2]);

    await assert.rejects(function () {
      return db.transaction(async function (tx) {
        return tx.transaction(async function () {}, { retry: true });
      });
    }, function (error) {
      return error instanceof nublox.NuBloxSqlError && error.category === 'unsupported';
    });

    await assert.rejects(function () {
      return db.transaction(function () {}, { retry: { maxAttempts: 2, onRetry: 'bad' } });
    }, /onRetry/);

    console.log('NuBloxSQL portable transaction policy contract passed');
  } finally {
    await db.close();
  }
}

main().catch(function (error) {
  console.error(error.stack || error);
  process.exitCode = 1;
});
