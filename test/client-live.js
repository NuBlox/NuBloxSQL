'use strict';

var assert = require('assert');
var nublox = require('..');
var sql = nublox.sql;

function configFor(dialect) {
  if (dialect === 'mysql') {
    return {
      dialect: 'mysql',
      host: process.env.MYSQL_HOST || '127.0.0.1',
      port: Number(process.env.MYSQL_PORT || 3306),
      user: process.env.MYSQL_USER,
      password: process.env.MYSQL_PASSWORD,
      database: process.env.MYSQL_DATABASE,
      ssl: 'disable',
      getServerPublicKey: true,
      pool: { max: 4 }
    };
  }
  if (dialect === 'postgresql') {
    return {
      dialect: 'postgresql',
      host: process.env.PGHOST || '127.0.0.1',
      port: Number(process.env.PGPORT || 5432),
      user: process.env.PGUSER,
      password: process.env.PGPASSWORD,
      database: process.env.PGDATABASE,
      pool: { max: 4 }
    };
  }
  throw new Error('Unsupported live client dialect: ' + dialect);
}

async function main() {
  var dialect = process.env.NUBLOX_DIALECT;
  if (!dialect) throw new Error('NUBLOX_DIALECT is required');

  var db = nublox.createClient(configFor(dialect));
  var table = sql.identifier('nublox_client_conformance');

  try {
    await db.execute(sql`DROP TABLE IF EXISTS ${table}`);
    await db.execute(sql`CREATE TABLE ${table} (id INTEGER PRIMARY KEY, name VARCHAR(100) NOT NULL)`);

    await db.execute(sql`INSERT INTO ${table} (id, name) VALUES (${1}, ${'portable'})`);
    var rows = await db.all(sql`SELECT id, name FROM ${table} WHERE id = ${1}`);
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].name, 'portable');

    var insertPrepared = await db.prepare(sql`
      INSERT INTO ${table} (id, name)
      VALUES (${sql.parameter('id')}, ${sql.parameter('name')})
    `);
    await insertPrepared.execute({ id: 10, name: 'prepared-one' });
    await insertPrepared.execute({ id: 11, name: 'prepared-two' });
    await insertPrepared.close();

    var selectPrepared = await db.prepare(sql`
      SELECT id, name FROM ${table} WHERE id = ${sql.parameter('id')}
    `);
    assert.strictEqual((await selectPrepared.one({ id: 10 })).name, 'prepared-one');
    assert.strictEqual((await selectPrepared.one({ id: 11 })).name, 'prepared-two');
    await selectPrepared.close();

    await db.transaction(async function (tx) {
      await tx.execute(sql`INSERT INTO ${table} (id, name) VALUES (${2}, ${'committed'})`);
      var txPrepared = await tx.prepare(sql`SELECT name FROM ${table} WHERE id = ${sql.parameter('id')}`);
      assert.strictEqual((await txPrepared.one({ id: 2 })).name, 'committed');
    });

    try {
      await db.transaction(async function (tx) {
        await tx.execute(sql`INSERT INTO ${table} (id, name) VALUES (${3}, ${'rolled-back'})`);
        throw new Error('rollback sentinel');
      });
      assert.fail('transaction should have rolled back');
    } catch (error) {
      assert.strictEqual(error.message, 'rollback sentinel');
    }

    var committed = await db.one(sql`SELECT id, name FROM ${table} WHERE id = ${2}`);
    assert.strictEqual(committed.name, 'committed');
    var rolledBack = await db.all(sql`SELECT id FROM ${table} WHERE id = ${3}`);
    assert.strictEqual(rolledBack.length, 0);

    console.log('NuBloxSQL live unified client contract passed for ' + dialect);
  } finally {
    try { await db.execute(sql`DROP TABLE IF EXISTS ${table}`); } catch (_) {}
    await db.close();
  }
}

main().catch(function (error) {
  console.error(error);
  process.exitCode = 1;
});
