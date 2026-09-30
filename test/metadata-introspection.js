'use strict';

var assert = require('assert');
var nublox = require('..');
var sql = nublox.sql;

async function build(client) {
  await client.execute(sql`
    CREATE TABLE ${sql.identifier('roles')} (
      id INTEGER NOT NULL,
      tenant_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      PRIMARY KEY (id, tenant_id)
    ) STRICT, WITHOUT ROWID
  `);
  await client.execute(sql`
    CREATE TABLE ${sql.identifier('users')} (
      id INTEGER PRIMARY KEY,
      role_id INTEGER,
      tenant_id INTEGER,
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL,
      full_name TEXT GENERATED ALWAYS AS (first_name || ' ' || last_name) STORED,
      email TEXT UNIQUE,
      score INTEGER CHECK (score >= 0),
      CONSTRAINT ck_users_email CHECK (email IS NULL OR instr(email, '@') > 1),
      FOREIGN KEY (role_id, tenant_id) REFERENCES roles(id, tenant_id) ON UPDATE CASCADE ON DELETE SET NULL
    ) STRICT
  `);
  await client.execute(sql`CREATE INDEX ${sql.identifier('idx_users_name')} ON ${sql.identifier('users')} (last_name, first_name)`);
  await client.execute(sql`CREATE INDEX ${sql.identifier('idx_users_lower_email')} ON ${sql.identifier('users')} (lower(email), score DESC) WHERE email IS NOT NULL`);
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
  var usersSummary = summary.tables.find(function (entry) { return entry.name === 'users'; });
  var rolesSummary = summary.tables.find(function (entry) { return entry.name === 'roles'; });
  assert.ok(usersSummary);
  assert.strictEqual(usersSummary.columns, undefined);
  assert.strictEqual(usersSummary.strict, true);
  assert.strictEqual(usersSummary.withoutRowid, false);
  assert.ok(usersSummary.definition.indexOf('STRICT') >= 0);
  assert.ok(rolesSummary);
  assert.strictEqual(rolesSummary.strict, true);
  assert.strictEqual(rolesSummary.withoutRowid, true);

  var deep = await client.catalog.snapshot({ tables: ['users'], concurrency: 2 });
  assert.strictEqual(deep.tables.length, 1);
  assert.strictEqual(deep.tables[0].name, 'users');
  assert.ok(deep.tables[0].columns.some(function (entry) { return entry.name === 'id' && entry.primaryKey === true; }));

  var generated = deep.tables[0].columns.find(function (entry) { return entry.name === 'full_name'; });
  assert.ok(generated);
  assert.strictEqual(generated.generated, true);
  assert.strictEqual(generated.generatedKind, 'stored');
  assert.strictEqual(generated.generationExpression, "first_name || ' ' || last_name");

  assert.ok(deep.tables[0].indexes.some(function (entry) { return entry.name === 'idx_users_name'; }));
  var expressionIndex = deep.tables[0].indexes.find(function (entry) { return entry.name === 'idx_users_lower_email'; });
  assert.ok(expressionIndex);
  assert.strictEqual(expressionIndex.partial, true);
  assert.strictEqual(expressionIndex.predicate, 'email IS NOT NULL');
  assert.strictEqual(expressionIndex.columns[0], null);
  assert.strictEqual(expressionIndex.keyParts[0].expression, 'lower(email)');
  assert.strictEqual(expressionIndex.keyParts[1].column, 'score');
  assert.strictEqual(expressionIndex.keyParts[1].descending, true);

  assert.strictEqual(deep.tables[0].foreignKeys.length, 1);
  assert.deepStrictEqual(Array.from(deep.tables[0].foreignKeys[0].columns), ['role_id', 'tenant_id']);
  assert.deepStrictEqual(Array.from(deep.tables[0].foreignKeys[0].referencedColumns), ['id', 'tenant_id']);
  assert.deepStrictEqual(Array.from(deep.tables[0].foreignKeys[0].sequence), [0, 1]);
  assert.strictEqual(deep.tables[0].foreignKeys[0].onUpdate, 'CASCADE');
  assert.strictEqual(deep.tables[0].foreignKeys[0].onDelete, 'SET NULL');

  var checks = deep.tables[0].constraints.filter(function (entry) { return entry.type === 'check'; });
  assert.strictEqual(checks.length, 2);
  assert.ok(checks.some(function (entry) { return entry.name === 'ck_users_email' && entry.expression.indexOf("instr(email, '@')") >= 0; }));
  assert.ok(checks.some(function (entry) { return entry.expression === 'score >= 0'; }));
  assert.ok(deep.tables[0].constraints.some(function (entry) { return entry.type === 'foreign-key'; }));

  client.native.attach(':memory:', 'archive');
  await client.execute('CREATE TABLE archive.audit (id INTEGER PRIMARY KEY, note TEXT NOT NULL)');
  var archiveTables = await client.catalog.tables({ database: 'archive' });
  assert.ok(archiveTables.some(function (entry) { return entry.name === 'audit' && entry.database === 'archive'; }));
  var archiveSnapshot = await client.catalog.snapshot({ database: 'archive', tables: ['audit'] });
  assert.strictEqual(archiveSnapshot.tables.length, 1);
  assert.strictEqual(archiveSnapshot.tables[0].database, 'archive');
  assert.ok(archiveSnapshot.tables[0].columns.some(function (entry) { return entry.name === 'note'; }));
  client.native.detach('archive');

  await assert.rejects(function () { return client.introspect({ concurrency: 0 }); }, function (error) {
    return error instanceof nublox.NuBloxSqlError && error.code === nublox.ERROR_CODES.CONFIGURATION;
  });

  await client.close();

  var oneShot = await nublox.introspect({ dialect: 'sqlite', filename: ':memory:' }, { deep: false });
  assert.strictEqual(oneShot.dialect, 'sqlite');
  assert.ok(Array.isArray(oneShot.tables));

  console.log('NuBloxSQL metadata introspection contract passed');
}

main().catch(function (error) {
  console.error(error);
  process.exitCode = 1;
});
