'use strict';

var assert = require('assert');
var nublox = require('..');
var sql = nublox.sql;

async function build(client) {
  await client.execute(sql`CREATE TABLE ${sql.identifier('roles')} (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE)`);
  await client.execute(sql`
    CREATE TABLE ${sql.identifier('users')} (
      id INTEGER PRIMARY KEY,
      role_id INTEGER,
      name TEXT NOT NULL,
      email TEXT UNIQUE,
      FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE SET NULL
    )
  `);
  await client.execute(sql`CREATE INDEX ${sql.identifier('idx_users_name')} ON ${sql.identifier('users')} (name)`);
}

async function main() {
  var client = nublox.createClient({ dialect: 'sqlite', filename: ':memory:' });
  assert.strictEqual(client.catalog, client.metadata);
  assert.strictEqual(typeof client.introspect, 'function');
  assert.strictEqual(typeof client.metadata.snapshot, 'function');
  await build(client);

  var summary = await client.introspect({ deep: false });
  assert.strictEqual(summary.dialect, 'sqlite');
  assert.ok(Object.isFrozen(summary));
  assert.ok(summary.databases.some(function (entry) { return entry.name === 'main'; }));
  assert.ok(summary.schemas.some(function (entry) { return entry.name === 'main'; }));
  assert.ok(summary.tables.some(function (entry) { return entry.name === 'users'; }));
  assert.strictEqual(summary.tables.find(function (entry) { return entry.name === 'users'; }).columns, undefined);

  var deep = await client.catalog.snapshot({ tables: ['users'], concurrency: 2 });
  assert.strictEqual(deep.tables.length, 1);
  assert.strictEqual(deep.tables[0].name, 'users');
  assert.ok(deep.tables[0].columns.some(function (entry) { return entry.name === 'id' && entry.primaryKey === true; }));
  assert.ok(deep.tables[0].indexes.some(function (entry) { return entry.name === 'idx_users_name'; }));
  assert.strictEqual(deep.tables[0].foreignKeys[0].referencedTable, 'roles');
  assert.ok(deep.tables[0].constraints.some(function (entry) { return entry.type === 'foreign-key'; }));

  assert.throws(function () { client.introspect({ concurrency: 0 }); }, function (error) {
    return error instanceof nublox.NuBloxSqlError && error.code === nublox.ERROR_CODES.CONFIGURATION;
  });

  await client.close();

  var file = ':memory:';
  var oneShot = await nublox.introspect({ dialect: 'sqlite', filename: file }, { deep: false });
  assert.strictEqual(oneShot.dialect, 'sqlite');
  assert.ok(Array.isArray(oneShot.tables));

  console.log('NuBloxSQL metadata introspection contract passed');
}

main().catch(function (error) {
  console.error(error);
  process.exitCode = 1;
});
