'use strict';

var assert = require('assert');
var nublox = require('..');

function configFor(dialect) {
  if (dialect === 'postgresql') return { dialect:'postgresql', host:process.env.PGHOST || '127.0.0.1', port:Number(process.env.PGPORT || 5432), user:process.env.PGUSER, password:process.env.PGPASSWORD, database:process.env.PGDATABASE, pool:{max:2} };
  if (dialect === 'mysql') return { dialect:'mysql', host:process.env.MYSQL_HOST || '127.0.0.1', port:Number(process.env.MYSQL_PORT || 3306), user:process.env.MYSQL_USER, password:process.env.MYSQL_PASSWORD, database:process.env.MYSQL_DATABASE, ssl:'disable', getServerPublicKey:true, pool:{max:2} };
  if (dialect === 'sqlite') return { dialect:'sqlite', filename:':memory:', pool:false };
  throw new Error('Unsupported ddl-v11 live dialect: ' + dialect);
}

async function main() {
  var dialect = process.env.NUBLOX_DIALECT || 'sqlite';
  var db = nublox.createClient(configFor(dialect));
  var model = nublox.capabilityModel;
  var table = 'nublox_compiler_ddl_v11';
  var seq = 'nublox_compiler_ddl_v11_seq';
  try {
    try { await db.execute('DROP TABLE IF EXISTS ' + table); } catch (_) {}
    if (dialect === 'postgresql') try { await db.execute('DROP SEQUENCE IF EXISTS ' + seq); } catch (_) {}
    var qualification = await model.qualifyClient(db);
    function compile(source) {
      var result = model.transpileSql(dialect, dialect, source, { sourceQualification:qualification, targetQualification:qualification });
      assert.strictEqual(result.scope, 'ddl-v11');
      assert.strictEqual(result.certified, true);
      return result.sql;
    }

    if (dialect === 'postgresql') {
      await db.execute(compile('CREATE SEQUENCE ' + seq + ' START WITH 10 INCREMENT BY 2 CACHE 1 NO CYCLE'));
      var a = await db.one("SELECT nextval('" + seq + "') AS v");
      var b = await db.one("SELECT nextval('" + seq + "') AS v");
      assert.strictEqual(Number(a.v), 10);
      assert.strictEqual(Number(b.v), 12);

      await db.execute(compile('CREATE TABLE ' + table + ' (id BIGINT GENERATED ALWAYS AS IDENTITY (START WITH 20 INCREMENT BY 3 CACHE 1 NO CYCLE), note TEXT)'));
      var r1 = await db.one("INSERT INTO " + table + " (note) VALUES ('a') RETURNING id");
      var r2 = await db.one("INSERT INTO " + table + " (note) VALUES ('b') RETURNING id");
      assert.strictEqual(Number(r1.id), 20);
      assert.strictEqual(Number(r2.id), 23);
    } else if (dialect === 'mysql') {
      await db.execute(compile('CREATE TABLE ' + table + ' (id BIGINT AUTO_INCREMENT PRIMARY KEY, note VARCHAR(20))'));
      await db.execute("INSERT INTO " + table + " (note) VALUES ('a'), ('b')");
      var rows = await db.query('SELECT id FROM ' + table + ' ORDER BY id');
      assert.strictEqual(Number(rows[0].id), 1);
      assert.strictEqual(Number(rows[1].id), 2);
    } else {
      await db.execute(compile('CREATE TABLE ' + table + ' (id INTEGER PRIMARY KEY AUTOINCREMENT, note TEXT)'));
      await db.execute("INSERT INTO " + table + " (note) VALUES ('a'), ('b')");
      await db.execute('DELETE FROM ' + table + ' WHERE id = 2');
      await db.execute("INSERT INTO " + table + " (note) VALUES ('c')");
      var row = await db.one("SELECT id FROM " + table + " WHERE note = 'c'");
      assert.strictEqual(Number(row.id), 3);
    }
  } finally {
    try { await db.execute('DROP TABLE IF EXISTS ' + table); } catch (_) {}
    if (dialect === 'postgresql') try { await db.execute('DROP SEQUENCE IF EXISTS ' + seq); } catch (_) {}
    await db.close();
  }
  console.log('NuBloxSQL Wave 5k live identity/autoincrement/sequence qualification: PASS for ' + dialect);
}
main().catch(function (error) { console.error(error && error.stack ? error.stack : error); process.exitCode = 1; });
