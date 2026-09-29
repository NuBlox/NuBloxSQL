'use strict';

var assert = require('assert');
var nublox = require('..');
var sql = nublox.sql;

async function main() {
  var mysql = nublox.createClient({ dialect: 'mysql', user: 'test', pool: false });
  var mysqlCompiled = mysql.compile(sql`SELECT * FROM ${sql.identifier('users')} WHERE id = ${42} AND name = ${'Stephen'}`);
  assert.strictEqual(mysqlCompiled.text, 'SELECT * FROM `users` WHERE id = ? AND name = ?');
  assert.deepStrictEqual(mysqlCompiled.parameters, [42, 'Stephen']);
  assert.strictEqual(mysql.supports('preparedStatements'), true);
  assert.throws(function () {
    mysql.compile(sql`SELECT * FROM users WHERE id = ${sql.parameter('id')}`);
  }, /only be used with prepare/);

  var postgresql = nublox.createClient({ dialect: 'postgresql', user: 'test', pool: false });
  var pgCompiled = postgresql.compile(sql`SELECT * FROM ${sql.identifier('public', 'users')} WHERE id = ${42} AND name = ${'Stephen'}`);
  assert.strictEqual(pgCompiled.text, 'SELECT * FROM "public"."users" WHERE id = $1 AND name = $2');
  assert.deepStrictEqual(pgCompiled.parameters, [42, 'Stephen']);
  assert.strictEqual(postgresql.supports('serverSideCursors'), true);

  var db = nublox.createClient({ dialect: 'sqlite', filename: ':memory:' });
  assert.strictEqual(db.dialect, 'sqlite');
  assert.strictEqual(db.supports('savepoints'), true);

  await db.execute(sql`CREATE TABLE ${sql.identifier('users')} (id INTEGER PRIMARY KEY, name TEXT NOT NULL)`);
  var inserted = await db.execute(sql`INSERT INTO ${sql.identifier('users')} (name) VALUES (${'Stephen'})`);
  assert.strictEqual(inserted.affectedRows, 1);

  var rows = await db.all(sql`SELECT id, name FROM ${sql.identifier('users')} WHERE name = ${'Stephen'}`);
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].name, 'Stephen');

  var one = await db.one(sql`SELECT id, name FROM ${sql.identifier('users')} WHERE id = ${rows[0].id}`);
  assert.strictEqual(one.name, 'Stephen');

  var insertUser = await db.prepare(sql`
    INSERT INTO ${sql.identifier('users')} (id, name)
    VALUES (${sql.parameter('id')}, ${sql.parameter('name')})
  `);
  assert.deepStrictEqual(insertUser.bindings, ['id', 'name']);
  await insertUser.execute({ id: 20, name: 'Prepared' });
  await insertUser.execute({ id: 21, name: 'Prepared Again' });
  await assert.rejects(function () { return insertUser.execute({ id: 22 }); }, /missing binding "name"/);
  await insertUser.close();
  assert.strictEqual(insertUser.closed, true);

  var findUser = await db.prepare(sql`
    SELECT id, name
    FROM ${sql.identifier('users')}
    WHERE id = ${sql.parameter('id')}
  `);
  var preparedRow = await findUser.one({ id: 20 });
  assert.strictEqual(preparedRow.name, 'Prepared');
  var preparedRows = await findUser.all({ id: 21 });
  assert.strictEqual(preparedRows.length, 1);
  assert.strictEqual(preparedRows[0].name, 'Prepared Again');
  await findUser.close();

  await db.transaction(async function (tx) {
    await tx.execute(sql`INSERT INTO ${sql.identifier('users')} (name) VALUES (${'Committed'})`);
    var txPrepared = await tx.prepare(sql`
      SELECT name FROM ${sql.identifier('users')} WHERE name = ${sql.parameter('name')}
    `);
    assert.strictEqual((await txPrepared.one({ name: 'Committed' })).name, 'Committed');
  });

  try {
    await db.transaction(async function (tx) {
      await tx.execute(sql`INSERT INTO ${sql.identifier('users')} (name) VALUES (${'Rolled Back'})`);
      throw new Error('rollback sentinel');
    });
    assert.fail('transaction should have thrown');
  } catch (error) {
    assert.strictEqual(error.message, 'rollback sentinel');
  }

  var committed = await db.all(sql`SELECT name FROM ${sql.identifier('users')} WHERE name = ${'Committed'}`);
  var rolledBack = await db.all(sql`SELECT name FROM ${sql.identifier('users')} WHERE name = ${'Rolled Back'}`);
  assert.strictEqual(committed.length, 1);
  assert.strictEqual(rolledBack.length, 0);

  await db.close();
  console.log('NuBloxSQL unified client contract passed');
}

main().catch(function (error) {
  console.error(error);
  process.exitCode = 1;
});
