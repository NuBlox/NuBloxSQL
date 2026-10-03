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
  throw new Error('Unsupported DDL live dialect: ' + dialect);
}

async function main() {
  var dialect = process.env.NUBLOX_DIALECT || 'sqlite';
  var db = nublox.createClient(configFor(dialect));
  var model = nublox.capabilityModel;
  var table = 'nublox_compiler_ddl_wave';
  var view = 'nublox_compiler_ddl_view';
  var index = 'nublox_compiler_ddl_amount_idx';
  var partial = 'nublox_compiler_ddl_positive_idx';
  var sequence = 'nublox_compiler_ddl_seq';
  var schema = 'nublox_compiler_ddl_schema';

  function compile(source, qualification) {
    var result = model.transpileSql('postgresql', dialect, source, qualification ? { targetQualification: qualification } : undefined);
    assert.strictEqual(result.scope, 'ddl-v1');
    assert.strictEqual(result.certified, true);
    return result.sql;
  }

  try {
    try { await db.execute('DROP VIEW IF EXISTS ' + view); } catch (_) {}
    try { await db.execute('DROP TABLE IF EXISTS ' + table); } catch (_) {}

    var qualification = await model.qualifyClient(db);
    var createTable = compile(
      'CREATE TABLE ' + table + ' (' +
      'id INTEGER PRIMARY KEY, ' +
      'name VARCHAR(100) NOT NULL UNIQUE, ' +
      'amount DECIMAL(12,2) DEFAULT 0 CHECK (amount >= 0)' +
      ')', qualification
    );
    await db.execute(createTable);
    await db.execute("INSERT INTO " + table + " (id, name, amount) VALUES (1, 'one', 10)");

    var createIndex = compile('CREATE INDEX ' + index + ' ON ' + table + ' (amount)', qualification);
    await db.execute(createIndex);

    if (dialect !== 'mysql') {
      var createPartial = compile('CREATE INDEX ' + partial + ' ON ' + table + ' (id) WHERE amount > 0', qualification);
      await db.execute(createPartial);
    }

    var createView = compile('CREATE VIEW ' + view + ' AS SELECT id, name, amount FROM ' + table + ' WHERE amount >= 0', qualification);
    await db.execute(createView);
    var rows = await db.all('SELECT id, name, amount FROM ' + view);
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(Number(rows[0].id), 1);
    assert.strictEqual(rows[0].name, 'one');

    if (dialect === 'postgresql') {
      await db.execute(compile('CREATE SEQUENCE ' + sequence, qualification));
      var next = await db.one("SELECT nextval('" + sequence + "') AS value");
      assert.strictEqual(Number(next.value), 1);
      await db.execute('DROP SEQUENCE ' + sequence);

      await db.execute(compile('CREATE SCHEMA ' + schema, qualification));
      var schemaRow = await db.one("SELECT schema_name FROM information_schema.schemata WHERE schema_name = '" + schema + "'");
      assert.strictEqual(schemaRow.schema_name, schema);
      await db.execute('DROP SCHEMA ' + schema);
    }

    await db.execute(compile('DROP VIEW ' + view, qualification));
    await db.execute(compile('DROP TABLE ' + table, qualification));
  } finally {
    try { if (dialect === 'postgresql') await db.execute('DROP SEQUENCE IF EXISTS ' + sequence); } catch (_) {}
    try { if (dialect === 'postgresql') await db.execute('DROP SCHEMA IF EXISTS ' + schema + ' CASCADE'); } catch (_) {}
    try { await db.execute('DROP VIEW IF EXISTS ' + view); } catch (_) {}
    try { await db.execute('DROP TABLE IF EXISTS ' + table); } catch (_) {}
    await db.close();
  }

  console.log('NuBloxSQL Wave 5 live DDL qualification: PASS for ' + dialect);
}

main().catch(function (error) {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
