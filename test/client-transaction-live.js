'use strict';

var assert = require('assert');
var nublox = require('..');
var sql = nublox.sql;

function configFor(dialect) {
  if (dialect === 'mysql') return {
    dialect: 'mysql', host: process.env.MYSQL_HOST || '127.0.0.1', port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER, password: process.env.MYSQL_PASSWORD, database: process.env.MYSQL_DATABASE,
    ssl: 'disable', getServerPublicKey: true, pool: { max: 2 }
  };
  if (dialect === 'postgresql') return {
    dialect: 'postgresql', host: process.env.PGHOST || '127.0.0.1', port: Number(process.env.PGPORT || 5432),
    user: process.env.PGUSER, password: process.env.PGPASSWORD, database: process.env.PGDATABASE, pool: { max: 2 }
  };
  throw new Error('Unsupported dialect: ' + dialect);
}

async function main() {
  var dialect = process.env.NUBLOX_DIALECT;
  if (!dialect) throw new Error('NUBLOX_DIALECT is required');
  var db = nublox.createClient(configFor(dialect));
  var table = sql.identifier('nublox_transaction_conformance');

  try {
    assert.strictEqual(db.supports('transactions'), true);
    assert.strictEqual(db.supports('savepoints'), true);
    assert.strictEqual(db.supports('nestedTransactions'), true);
    assert.strictEqual(db.supports('transactionIsolation'), true);
    assert.strictEqual(db.supports('readOnlyTransactions'), true);
    assert.strictEqual(db.supports('deferrableTransactions'), dialect === 'postgresql');

    await db.execute(sql`DROP TABLE IF EXISTS ${table}`);
    await db.execute(sql`CREATE TABLE ${table} (id INTEGER PRIMARY KEY, value VARCHAR(100) NOT NULL)`);

    await db.transaction(async function (tx) {
      await tx.execute(sql`INSERT INTO ${table} (id, value) VALUES (${1}, ${'outer'})`);
      await tx.transaction(async function (nested) {
        assert.strictEqual(nested, tx);
        await nested.execute(sql`INSERT INTO ${table} (id, value) VALUES (${2}, ${'nested-commit'})`);
      });
      try {
        await tx.transaction(async function (nested) {
          await nested.execute(sql`INSERT INTO ${table} (id, value) VALUES (${3}, ${'nested-rollback'})`);
          throw new Error('nested rollback sentinel');
        });
      } catch (error) {
        assert.strictEqual(error.message, 'nested rollback sentinel');
      }
      await tx.execute(sql`INSERT INTO ${table} (id, value) VALUES (${4}, ${'outer-continues'})`);
    }, { isolationLevel: 'read-committed' });

    var ids = (await db.all(sql`SELECT id FROM ${table} ORDER BY id`)).map(function (row) { return Number(row.id); });
    assert.deepStrictEqual(ids, [1, 2, 4]);

    await db.transaction(async function (tx) {
      var rows = await tx.all(sql`SELECT id FROM ${table}`);
      assert.strictEqual(rows.length, 3);
    }, { readOnly: true, isolationLevel: 'read-committed' });

    if (dialect === 'postgresql') {
      await db.transaction(async function (tx) {
        var row = await tx.one('SHOW transaction_read_only');
        assert.strictEqual(row.transaction_read_only, 'on');
      }, { readOnly: true, isolationLevel: 'serializable', deferrable: true });
    } else {
      await assert.rejects(function () {
        return db.transaction(async function () {}, { deferrable: true });
      }, function (error) { return error && error.category === 'unsupported'; });
    }

    console.log('NuBloxSQL live advanced transaction contract passed for ' + dialect);
  } finally {
    try { await db.execute(sql`DROP TABLE IF EXISTS ${table}`); } catch (_) {}
    await db.close();
  }
}

main().catch(function (error) {
  console.error(error.stack || error);
  process.exitCode = 1;
});
