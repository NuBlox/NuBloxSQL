'use strict';

var assert = require('assert');
var nublox = require('..');
var sql = nublox.sql;

async function main() {
  var db = nublox.createClient({ dialect: 'sqlite', filename: ':memory:' });
  try {
    await db.execute(sql`CREATE TABLE tx_contract (id INTEGER PRIMARY KEY, value TEXT)`);

    await db.transaction(async function (tx) {
      await tx.execute(sql`INSERT INTO tx_contract (id, value) VALUES (${1}, ${'keep'})`);
      await tx.savepoint('before_optional');
      await tx.execute(sql`INSERT INTO tx_contract (id, value) VALUES (${2}, ${'remove'})`);
      await tx.rollbackTo('before_optional');
      await tx.releaseSavepoint('before_optional');
    }, { mode: 'immediate' });

    assert.strictEqual((await db.all(sql`SELECT id FROM tx_contract ORDER BY id`)).length, 1);

    var attempts = 0;
    await db.transaction(async function (tx) {
      attempts += 1;
      if (attempts === 1) {
        var retryable = new Error('retry me');
        retryable.retryable = true;
        throw retryable;
      }
      await tx.execute(sql`INSERT INTO tx_contract (id, value) VALUES (${3}, ${'retried'})`);
    }, { retries: 1, retryDelayMs: 0 });
    assert.strictEqual(attempts, 2);
    assert.strictEqual((await db.one(sql`SELECT value FROM tx_contract WHERE id = ${3}`)).value, 'retried');

    var plainAttempts = 0;
    await assert.rejects(function () {
      return db.transaction(async function () {
        plainAttempts += 1;
        throw new Error('application failure');
      }, { retries: 3 });
    }, /application failure/);
    assert.strictEqual(plainAttempts, 1);

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
