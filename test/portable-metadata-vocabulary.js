'use strict';

var assert = require('assert');
var portable = require('../lib/client/PortableMetadata');
var nublox = require('..');

function sample(dialect, table) {
  return {
    dialect: dialect,
    scope: { database: table.database, schema: table.schema },
    databases: [{ name: table.database || 'default', native: { dialect: dialect } }],
    schemas: [{ database: table.database || null, name: table.schema || 'main', native: { dialect: dialect } }],
    tables: [table]
  };
}

var sqlite = portable.project(sample('sqlite', {
  database: 'main', schema: 'main', name: 'users', type: 'table', native: { sql: 'CREATE TABLE users(...)' },
  columns: [
    { database: 'main', schema: 'main', table: 'users', name: 'id', ordinal: 0, dataType: 'INTEGER', nativeType: 'INTEGER', nullable: false, default: null, primaryKey: true, generated: false, native: {} },
    { database: 'main', schema: 'main', table: 'users', name: 'slug', ordinal: 1, dataType: 'TEXT', nativeType: 'TEXT', nullable: true, default: null, primaryKey: false, generated: true, generatedKind: 'stored', generationExpression: 'lower(name)', native: {} }
  ],
  indexes: [{ database: 'main', schema: 'main', table: 'users', name: 'idx_users_slug', unique: true, primary: false, method: 'btree', columns: ['slug'], predicate: 'slug IS NOT NULL', native: {} }],
  foreignKeys: [], constraints: [{ database: 'main', schema: 'main', table: 'users', name: 'pk_users', type: 'primary_key', columns: ['id'], definition: 'PRIMARY KEY (id)', native: {} }]
}));

assert.strictEqual(sqlite.vocabularyVersion, 1);
assert.strictEqual(sqlite.dialect, 'sqlite');
assert.strictEqual(sqlite.tables[0].kind, 'table');
assert.strictEqual(sqlite.tables[0].columns[0].nullability, 'not-null');
assert.strictEqual(sqlite.tables[0].columns[0].primaryKey, true);
assert.strictEqual(sqlite.tables[0].columns[1].generated.enabled, true);
assert.strictEqual(sqlite.tables[0].columns[1].generated.kind, 'stored');
assert.strictEqual(sqlite.tables[0].columns[1].generated.expression, 'lower(name)');
assert.strictEqual(sqlite.tables[0].indexes[0].keyParts[0].column, 'slug');
assert.strictEqual(sqlite.tables[0].indexes[0].predicate, 'slug IS NOT NULL');
assert.strictEqual(sqlite.tables[0].constraints[0].type, 'primary-key');
assert.ok(Object.isFrozen(sqlite));
assert.ok(Object.isFrozen(sqlite.tables[0].columns[0]));

var mysql = portable.project(sample('mysql', {
  database: 'app', schema: 'app', name: 'orders', type: 'table', native: {},
  columns: [{ database: 'app', schema: 'app', table: 'orders', name: 'id', ordinal: 1, dataType: 'bigint', nativeType: 'bigint unsigned', nullable: false, default: null, primaryKey: true, autoIncrement: true, generated: false, native: {} }],
  indexes: [{ database: 'app', schema: 'app', table: 'orders', name: 'PRIMARY', unique: true, primary: true, method: 'BTREE', keyParts: [{ ordinal: 1, column: 'id', descending: false }], native: {} }],
  foreignKeys: [{ database: 'app', schema: 'app', table: 'orders', name: 'fk_orders_customer', columns: ['customer_id'], referencedDatabase: 'app', referencedSchema: 'app', referencedTable: 'customers', referencedColumns: ['id'], onUpdate: 'CASCADE', onDelete: 'RESTRICT', match: null, native: {} }],
  constraints: []
}));
assert.strictEqual(mysql.tables[0].columns[0].identity, true);
assert.strictEqual(mysql.tables[0].foreignKeys[0].onDelete, 'RESTRICT');

var postgresql = portable.project(sample('postgresql', {
  database: 'app', schema: 'public', name: 'events', type: 'foreign-table', native: {},
  columns: [{ database: 'app', schema: 'public', table: 'events', name: 'payload', ordinal: 2, dataType: 'jsonb', nativeType: 'jsonb', nullable: null, default: undefined, primaryKey: false, identity: false, generated: false, native: {} }],
  indexes: [], foreignKeys: [],
  constraints: [{ database: 'app', schema: 'public', table: 'events', name: 'ck_payload', type: 'CHECK', columns: ['payload'], expression: 'payload IS NOT NULL', deferrable: false, initiallyDeferred: false, native: {} }]
}));
assert.strictEqual(postgresql.tables[0].kind, 'foreign-table');
assert.strictEqual(postgresql.tables[0].columns[0].nullability, 'unknown');
assert.strictEqual(postgresql.tables[0].constraints[0].type, 'check');
assert.strictEqual(postgresql.tables[0].constraints[0].definition, 'payload IS NOT NULL');
assert.strictEqual(postgresql.tables[0].constraints[0].deferrable, false);

async function liveSnapshotContract() {
  var client = nublox.createClient({ dialect: 'sqlite', filename: ':memory:' });
  await client.execute('CREATE TABLE portable_users (id INTEGER PRIMARY KEY, email TEXT NOT NULL UNIQUE)');
  var snapshot = await client.introspect({ deep: true });
  assert.ok(snapshot.portable);
  assert.strictEqual(snapshot.portable.vocabularyVersion, 1);
  assert.strictEqual(snapshot.portable.dialect, 'sqlite');
  var table = snapshot.portable.tables.find(function (entry) { return entry.name === 'portable_users'; });
  assert.ok(table);
  assert.ok(table.columns.some(function (column) { return column.name === 'id' && column.primaryKey === true; }));
  assert.ok(table.columns.some(function (column) { return column.name === 'email' && column.nullability === 'not-null'; }));
  assert.ok(Object.isFrozen(snapshot.portable));
  await client.close();
}

liveSnapshotContract().then(function () {
  console.log('NuBloxSQL portable metadata vocabulary contract passed');
}).catch(function (error) {
  console.error(error);
  process.exitCode = 1;
});
