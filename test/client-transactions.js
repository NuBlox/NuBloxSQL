'use strict';

var assert = require('assert');
var nublox = require('..');
var sql = nublox.sql;

async function main() {
  var db = nublox.createClient({ dialect: 'sqlite', filename: ':memory:' });
  try {
    assert.strictEqual(db.supports('transactions'), true);
    assert.strictEqual(db.supports('savepoints'), true);
    assert.strictEqual(db.supports('nestedTransactions'), true);
    assert.strictEqual(db.supports('transactionIsolation'), false);

    await db.execute(sql`CREATE TABLE tx_contract (id INTEGER PRIMARY KEY, value TEXT)`);

    await db.transaction(async function (tx) {
      await tx.execute(sql`INSERT INTO tx_contract (id, value) VALUES (${1}, ${'keep'})`);
      await tx.savepoint('before_optional');
      await tx.execute(sql`INSERT INTO tx_contract (id, value) VALUES (${2}, ${'remove'})`);
      await tx.rollbackTo('before_optional');
      await tx.releaseSavepoint('before_optional');
    }, { mode: 'immediate' });

    assert.deepStrictEqual((await db.all(sql`SELECT id FROM tx_contract ORDER BY id`)).map(function (row) { return Number(row.id); }), [1]);

    await db.transaction(async function (tx) {
      await tx.execute(sql`INSERT INTO tx_contract (id, value) VALUES (${4}, ${'outer'})`);
      await tx.transaction(async function (nested) {
        assert.strictEqual(nested, tx);
        await nested.execute(sql`INSERT INTO tx_contract (id, value) VALUES (${5}, ${'nested-commit'})`);
      });
      try {
        await tx.transaction(async function (nested) {
          await nested.execute(sql`INSERT INTO tx_contract (id, value) VALUES (${6}, ${'nested-rollback'})`);
          throw new Error('nested rollback sentinel');
        });
      } catch (error) {
        assert.strictEqual(error.message, 'nested rollback sentinel');
      }
      await tx.execute(sql`INSERT INTO tx_contract (id, value) VALUES (${7}, ${'outer-continues'})`);
    });

    assert.deepStrictEqual((await db.all(sql`SELECT id FROM tx_contract WHERE id >= 4 ORDER BY id`)).map(function (row) { return Number(row.id); }), [4, 5, 7]);

    var attempts = 0;
    await db.transaction(async function (tx) {
      attempts += 1;
      assert.strictEqual(tx.transactionAttempt, attempts);
      if (attempts === 1) {
        var retryable = new Error('retry me');
        retryable.retryable = true;
        throw retryable;
      }
      await tx.execute(sql`INSERT INTO tx_contract (id, value) VALUES (${3}, ${'retried'})`);
    }, { retries: 1, retryDelayMs: 0 });
    assert.strictEqual(attempts, 2);
    assert.strictEqual((await db.one(sql`SELECT value FROM tx_contract WHERE id = ${3}`)).value, 'retried');

    var modernAttempts = 0;
    await db.transaction(async function () {
      modernAttempts += 1;
      if (modernAttempts === 1) {
        var transient = new Error('retry modern');
        transient.category = 'serialization';
        throw transient;
      }
    }, { retry: { maxAttempts: 2, delayMs: 0 } });
    assert.strictEqual(modernAttempts, 2);

    var plainAttempts = 0;
    await assert.rejects(function () {
      return db.transaction(async function () {
        plainAttempts += 1;
        throw new Error('application failure');
      }, { retries: 3 });
    }, /application failure/);
    assert.strictEqual(plainAttempts, 1);

    await assert.rejects(function () {
      return db.transaction(async function () {}, { isolationLevel: 'serializable' });
    }, function (error) { return error && error.category === 'unsupported'; });

    await assert.rejects(function () {
      return db.transaction(async function () {}, { retries: -1 });
    }, /retries/);

    console.log('NuBloxSQL advanced transaction contract passed');
  } finally {
    await db.close();
  }
}

main().catch(function (error) {
  console.error(error.stack || error);
  process.exitCode = 1;
});
