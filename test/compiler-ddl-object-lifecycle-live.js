'use strict';

var assert = require('assert');
var nublox = require('..');

function configFor(dialect) {
  if (dialect === 'postgresql') return { dialect: 'postgresql', host: process.env.PGHOST || '127.0.0.1', port: Number(process.env.PGPORT || 5432), user: process.env.PGUSER, password: process.env.PGPASSWORD, database: process.env.PGDATABASE, pool: { max: 2 } };
  if (dialect === 'mysql') return { dialect: 'mysql', host: process.env.MYSQL_HOST || '127.0.0.1', port: Number(process.env.MYSQL_PORT || 3306), user: process.env.MYSQL_USER, password: process.env.MYSQL_PASSWORD, database: process.env.MYSQL_DATABASE, ssl: 'disable', getServerPublicKey: true, pool: { max: 2 } };
  if (dialect === 'sqlite') return { dialect: 'sqlite', filename: ':memory:', pool: false };
  throw new Error('Unsupported ddl-v4 live dialect: ' + dialect);
}

async function main() {
  var dialect = process.env.NUBLOX_DIALECT || 'sqlite';
  var db = nublox.createClient(configFor(dialect));
  var model = nublox.capabilityModel;
  var table = 'nublox_compiler_ddl_v4';
  var view = table + '_view';
  var index = table + '_idx';
  try {
    await db.execute('DROP VIEW IF EXISTS ' + view);
    await db.execute('DROP TABLE IF EXISTS ' + table);
    var qualification = await model.qualifyClient(db);

    function compile(sourceDialect, source) {
      var result = model.transpileSql(sourceDialect, dialect, source, { targetQualification: qualification, sourceQualification: sourceDialect === dialect ? qualification : undefined });
      assert.strictEqual(result.scope, 'ddl-v4');
      assert.strictEqual(result.certified, true);
      return result.sql;
    }

    await db.execute(compile('postgresql', 'CREATE TABLE IF NOT EXISTS ' + table + ' (id INTEGER PRIMARY KEY, code VARCHAR(20))'));
    await db.execute(compile('postgresql', 'CREATE TABLE IF NOT EXISTS ' + table + ' (id INTEGER PRIMARY KEY, code VARCHAR(20))'));
    await db.execute('INSERT INTO ' + table + " (id, code) VALUES (1, 'alpha')");

    await db.execute('CREATE VIEW ' + view + ' AS SELECT id FROM ' + table);
    await db.execute(compile(dialect, 'DROP VIEW IF EXISTS ' + view));
    await db.execute(compile(dialect, 'DROP VIEW IF EXISTS ' + view));

    if (dialect === 'mysql') {
      await db.execute('CREATE INDEX ' + index + ' ON ' + table + ' (code)');
      var mysqlDrop = model.transpileSql('mysql', 'mysql', 'DROP INDEX ' + index + ' ON ' + table, { sourceQualification: qualification, targetQualification: qualification });
      assert.strictEqual(mysqlDrop.scope, 'ddl-v4'); assert.strictEqual(mysqlDrop.certified, true);
      await db.execute(mysqlDrop.sql);
      assert.throws(function () { model.parseSql('mysql', 'DROP INDEX IF EXISTS ' + index + ' ON ' + table); }, /not valid MySQL source syntax/);
    } else {
      var createIndex = compile('postgresql', 'CREATE INDEX IF NOT EXISTS ' + index + ' ON ' + table + ' (code)');
      await db.execute(createIndex); await db.execute(createIndex);
      var dropIndex = compile('postgresql', 'DROP INDEX IF EXISTS ' + index);
      await db.execute(dropIndex); await db.execute(dropIndex);
    }

    if (dialect === 'postgresql') {
      var schema = 'nublox_ddl_v4_schema';
      var sequence = 'nublox_ddl_v4_sequence';
      await db.execute('DROP SCHEMA IF EXISTS ' + schema);
      await db.execute('DROP SEQUENCE IF EXISTS ' + sequence);
      await db.execute(compile('postgresql', 'CREATE SCHEMA IF NOT EXISTS ' + schema));
      await db.execute(compile('postgresql', 'DROP SCHEMA IF EXISTS ' + schema));
      await db.execute(compile('postgresql', 'CREATE SEQUENCE IF NOT EXISTS ' + sequence));
      await db.execute(compile('postgresql', 'CREATE SEQUENCE IF NOT EXISTS ' + sequence));
      await db.execute(compile('postgresql', 'DROP SEQUENCE IF EXISTS ' + sequence));
      await db.execute(compile('postgresql', 'DROP SEQUENCE IF EXISTS ' + sequence));
    }

    await db.execute(compile(dialect, 'DROP TABLE IF EXISTS ' + table));
    await db.execute(compile(dialect, 'DROP TABLE IF EXISTS ' + table));
  } finally {
    try { await db.execute('DROP VIEW IF EXISTS ' + view); } catch (_) {}
    try { await db.execute('DROP TABLE IF EXISTS ' + table); } catch (_) {}
    if (dialect === 'postgresql') {
      try { await db.execute('DROP SCHEMA IF EXISTS nublox_ddl_v4_schema'); } catch (_) {}
      try { await db.execute('DROP SEQUENCE IF EXISTS nublox_ddl_v4_sequence'); } catch (_) {}
    }
    await db.close();
  }
  console.log('NuBloxSQL Wave 5d live object lifecycle qualification: PASS for ' + dialect);
}

main().catch(function (error) { console.error(error && error.stack ? error.stack : error); process.exitCode = 1; });
