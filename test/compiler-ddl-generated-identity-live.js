'use strict';

var assert = require('assert');
var nublox = require('..');

function configFor(dialect) {
  if (dialect === 'postgresql') return { dialect:'postgresql', host:process.env.PGHOST || '127.0.0.1', port:Number(process.env.PGPORT || 5432), user:process.env.PGUSER, password:process.env.PGPASSWORD, database:process.env.PGDATABASE, pool:{max:2} };
  if (dialect === 'mysql') return { dialect:'mysql', host:process.env.MYSQL_HOST || '127.0.0.1', port:Number(process.env.MYSQL_PORT || 3306), user:process.env.MYSQL_USER, password:process.env.MYSQL_PASSWORD, database:process.env.MYSQL_DATABASE, ssl:'disable', getServerPublicKey:true, pool:{max:2} };
  if (dialect === 'sqlite') return { dialect:'sqlite', filename:':memory:', pool:false };
  throw new Error('Unsupported ddl-v6 live dialect: ' + dialect);
}

async function main() {
  var dialect = process.env.NUBLOX_DIALECT || 'sqlite';
  var db = nublox.createClient(configFor(dialect));
  var model = nublox.capabilityModel;
  var table = 'nublox_compiler_ddl_v6';
  var identityTable = table + '_identity';
  var virtualTable = table + '_virtual';
  try {
    await db.execute('DROP TABLE IF EXISTS ' + virtualTable);
    await db.execute('DROP TABLE IF EXISTS ' + identityTable);
    await db.execute('DROP TABLE IF EXISTS ' + table);
    var qualification = await model.qualifyClient(db);
    function compile(source) {
      var result = model.transpileSql(dialect, dialect, source, { sourceQualification:qualification, targetQualification:qualification });
      assert.strictEqual(result.scope, 'ddl-v6');
      assert.strictEqual(result.certified, true);
      return result.sql;
    }

    var storedSql = compile('CREATE TABLE ' + table + ' (a INTEGER, b INTEGER, total INTEGER GENERATED ALWAYS AS (a + b) STORED)');
    await db.execute(storedSql);
    await db.execute('INSERT INTO ' + table + ' (a, b) VALUES (2, 3)');
    var stored = await db.one('SELECT total FROM ' + table);
    assert.strictEqual(Number(stored.total), 5);

    if (dialect === 'postgresql') {
      var identitySql = compile('CREATE TABLE ' + identityTable + ' (id BIGINT GENERATED ALWAYS AS IDENTITY)');
      await db.execute(identitySql);
      var identity = await db.one('INSERT INTO ' + identityTable + ' DEFAULT VALUES RETURNING id');
      assert.strictEqual(Number(identity.id), 1);

      var major = Number(String(qualification.version || '').split('.')[0]);
      if (major >= 18) {
        var virtualSql = compile('CREATE TABLE ' + virtualTable + ' (a INTEGER, b INTEGER, total INTEGER GENERATED ALWAYS AS (a + b) VIRTUAL)');
        await db.execute(virtualSql);
        await db.execute('INSERT INTO ' + virtualTable + ' (a, b) VALUES (4, 5)');
        var virtualRow = await db.one('SELECT total FROM ' + virtualTable);
        assert.strictEqual(Number(virtualRow.total), 9);
      }
    }
  } finally {
    try { await db.execute('DROP TABLE IF EXISTS ' + virtualTable); } catch (_) {}
    try { await db.execute('DROP TABLE IF EXISTS ' + identityTable); } catch (_) {}
    try { await db.execute('DROP TABLE IF EXISTS ' + table); } catch (_) {}
    await db.close();
  }
  console.log('NuBloxSQL Wave 5f live generated/identity qualification: PASS for ' + dialect);
}

main().catch(function (error) { console.error(error && error.stack ? error.stack : error); process.exitCode = 1; });
