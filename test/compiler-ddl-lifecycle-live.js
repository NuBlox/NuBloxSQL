'use strict';

var assert = require('assert');
var nublox = require('..');

function configFor(dialect) {
  if (dialect === 'postgresql') return {
    dialect: 'postgresql', host: process.env.PGHOST || '127.0.0.1', port: Number(process.env.PGPORT || 5432),
    user: process.env.PGUSER, password: process.env.PGPASSWORD, database: process.env.PGDATABASE, pool: { max: 2 }
  };
  if (dialect === 'mysql') return {
    dialect: 'mysql', host: process.env.MYSQL_HOST || '127.0.0.1', port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER, password: process.env.MYSQL_PASSWORD, database: process.env.MYSQL_DATABASE,
    ssl: 'disable', getServerPublicKey: true, pool: { max: 2 }
  };
  if (dialect === 'sqlite') return { dialect: 'sqlite', filename: ':memory:', pool: false };
  throw new Error('Unsupported DDL lifecycle dialect: ' + dialect);
}

async function main() {
  var dialect = process.env.NUBLOX_DIALECT || 'sqlite';
  var db = nublox.createClient(configFor(dialect));
  var model = nublox.capabilityModel;
  var table = 'nublox_compiler_alter_wave';
  var renamedTable = 'nublox_compiler_alter_archive';
  var currentTable = table;

  function compile(source, qualification) {
    var result = model.transpileSql('postgresql', dialect, source, qualification ? { targetQualification: qualification } : undefined);
    assert.strictEqual(result.scope, 'ddl-v2');
    assert.strictEqual(result.certified, true);
    return result.sql;
  }

  try {
    try { await db.execute('DROP TABLE IF EXISTS ' + renamedTable); } catch (_) {}
    try { await db.execute('DROP TABLE IF EXISTS ' + table); } catch (_) {}
    await db.execute('CREATE TABLE ' + table + ' (id INTEGER PRIMARY KEY, name VARCHAR(100))');
    await db.execute("INSERT INTO " + table + " (id, name) VALUES (1, 'one')");

    var qualification = await model.qualifyClient(db);

    await db.execute(compile('ALTER TABLE ' + table + ' ADD COLUMN note VARCHAR(120)', qualification));
    await db.execute("UPDATE " + table + " SET note = 'memo' WHERE id = 1");
    var added = await db.one('SELECT id, note FROM ' + table + ' WHERE id = 1');
    assert.strictEqual(added.note, 'memo');

    await db.execute(compile('ALTER TABLE ' + table + ' RENAME COLUMN note TO memo', qualification));
    var renamedColumn = await db.one('SELECT id, memo FROM ' + table + ' WHERE id = 1');
    assert.strictEqual(renamedColumn.memo, 'memo');

    await db.execute(compile('ALTER TABLE ' + table + ' RENAME TO ' + renamedTable, qualification));
    currentTable = renamedTable;
    var renamed = await db.one('SELECT id, memo FROM ' + renamedTable + ' WHERE id = 1');
    assert.strictEqual(Number(renamed.id), 1);

    await db.execute(compile('ALTER TABLE ' + renamedTable + ' DROP COLUMN memo', qualification));
    var finalRow = await db.one('SELECT id, name FROM ' + renamedTable + ' WHERE id = 1');
    assert.strictEqual(Number(finalRow.id), 1);
    assert.strictEqual(finalRow.name, 'one');
  } finally {
    try { await db.execute('DROP TABLE IF EXISTS ' + currentTable); } catch (_) {}
    if (currentTable !== table) { try { await db.execute('DROP TABLE IF EXISTS ' + table); } catch (_) {} }
    if (currentTable !== renamedTable) { try { await db.execute('DROP TABLE IF EXISTS ' + renamedTable); } catch (_) {} }
    await db.close();
  }

  console.log('NuBloxSQL Wave 5b live ALTER TABLE qualification: PASS for ' + dialect);
}

main().catch(function (error) {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
