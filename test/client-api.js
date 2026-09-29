'use strict';

var assert = require('assert');
var nublox = require('..');
var sql = nublox.sql;

async function main() {
  assert.strictEqual(typeof nublox.NuBloxSqlError, 'function');
  assert.strictEqual(typeof nublox.ClientRowStream, 'function');
  assert.strictEqual(nublox.ERROR_CATEGORIES.UNIQUE_VIOLATION, 'unique_violation');

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
  assert.ok(db.metadata);

  await db.execute(sql`CREATE TABLE ${sql.identifier('roles')} (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE)`);
  await db.execute(sql`
    CREATE TABLE ${sql.identifier('users')} (
      id INTEGER PRIMARY KEY,
      role_id INTEGER,
      name TEXT NOT NULL,
      email TEXT UNIQUE,
      FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE SET NULL
    )
  `);
  await db.execute(sql`CREATE INDEX ${sql.identifier('idx_users_name')} ON ${sql.identifier('users')} (name)`);

  var databases = await db.metadata.databases();
  assert.ok(databases.some(function (entry) { return entry.name === 'main'; }));
  var schemas = await db.metadata.schemas();
  assert.ok(schemas.some(function (entry) { return entry.name === 'main'; }));
  var metadataTables = await db.metadata.tables();
  assert.ok(metadataTables.some(function (entry) { return entry.name === 'users' && entry.type === 'table'; }));
  assert.ok(metadataTables.some(function (entry) { return entry.name === 'roles' && entry.type === 'table'; }));
  var metadataColumns = await db.metadata.columns('users');
  assert.strictEqual(metadataColumns.find(function (entry) { return entry.name === 'id'; }).primaryKey, true);
  assert.strictEqual(metadataColumns.find(function (entry) { return entry.name === 'name'; }).nullable, false);
  var metadataIndexes = await db.metadata.indexes('users');
  assert.ok(metadataIndexes.some(function (entry) { return entry.name === 'idx_users_name' && entry.columns[0] === 'name'; }));
  assert.ok(metadataIndexes.some(function (entry) { return entry.unique === true && entry.columns.indexOf('email') >= 0; }));
  var metadataForeignKeys = await db.metadata.foreignKeys('users');
  assert.strictEqual(metadataForeignKeys.length, 1);
  assert.deepStrictEqual(Array.from(metadataForeignKeys[0].columns), ['role_id']);
  assert.strictEqual(metadataForeignKeys[0].referencedTable, 'roles');
  assert.deepStrictEqual(Array.from(metadataForeignKeys[0].referencedColumns), ['id']);
  assert.strictEqual(metadataForeignKeys[0].onDelete, 'SET NULL');
  var metadataConstraints = await db.metadata.constraints('users');
  assert.ok(metadataConstraints.some(function (entry) { return entry.type === 'primary-key'; }));
  assert.ok(metadataConstraints.some(function (entry) { return entry.type === 'unique' && entry.columns.indexOf('email') >= 0; }));
  assert.ok(metadataConstraints.some(function (entry) { return entry.type === 'foreign-key'; }));
  var metadataTable = await db.metadata.table('users');
  assert.strictEqual(metadataTable.name, 'users');
  assert.ok(metadataTable.definition.indexOf('CREATE TABLE') >= 0);
  assert.ok(metadataTable.columns.length >= 4);
  assert.ok(metadataTable.indexes.length >= 2);
  assert.strictEqual(await db.metadata.table('missing_table'), null);

  var inserted = await db.execute(sql`INSERT INTO ${sql.identifier('users')} (name) VALUES (${'Stephen'})`);
  assert.strictEqual(inserted.affectedRows, 1);

  var rows = await db.all(sql`SELECT id, name FROM ${sql.identifier('users')} WHERE name = ${'Stephen'}`);
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].name, 'Stephen');

  var one = await db.one(sql`SELECT id, name FROM ${sql.identifier('users')} WHERE id = ${rows[0].id}`);
  assert.strictEqual(one.name, 'Stephen');

  await assert.rejects(
    function () { return db.one(sql`SELECT id FROM ${sql.identifier('users')} WHERE id = ${999999}`); },
    function (error) {
      assert.ok(error instanceof nublox.NuBloxSqlError);
      assert.strictEqual(error.category, 'cardinality');
      assert.strictEqual(error.code, 'NUBLOXSQL_CARDINALITY');
      assert.strictEqual(error.dialect, 'sqlite');
      return true;
    }
  );

  var insertUser = await db.prepare(sql`
    INSERT INTO ${sql.identifier('users')} (id, name)
    VALUES (${sql.parameter('id')}, ${sql.parameter('name')})
  `);
  assert.deepStrictEqual(insertUser.bindings, ['id', 'name']);
  await insertUser.execute({ id: 20, name: 'Prepared' });
  await insertUser.execute({ id: 21, name: 'Prepared Again' });
  await assert.rejects(function () { return insertUser.execute({ id: 22 }); }, /missing binding "name"/);
  await assert.rejects(
    function () { return insertUser.execute({ id: 20, name: 'Duplicate' }); },
    function (error) {
      assert.ok(error instanceof nublox.NuBloxSqlError);
      assert.strictEqual(error.category, 'unique_violation');
      assert.strictEqual(error.code, 'NUBLOXSQL_UNIQUE_VIOLATION');
      assert.strictEqual(error.dialect, 'sqlite');
      assert.ok(error.native);
      return true;
    }
  );
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

  var streamed = [];
  var rowStream = db.stream(sql`
    SELECT id, name FROM ${sql.identifier('users')}
    WHERE id >= ${20}
    ORDER BY id
  `);
  for await (var streamedRow of rowStream) streamed.push(streamedRow);
  assert.deepStrictEqual(streamed.map(function (row) { return row.name; }), ['Prepared', 'Prepared Again']);
  assert.strictEqual(rowStream.closed, true);

  var earlyStream = db.stream(sql`SELECT id, name FROM ${sql.identifier('users')} ORDER BY id`);
  var firstStreamed = await earlyStream.next();
  assert.strictEqual(firstStreamed.done, false);
  await earlyStream.close();
  assert.strictEqual(earlyStream.closed, true);

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
    assert.strictEqual(error instanceof nublox.NuBloxSqlError, false);
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