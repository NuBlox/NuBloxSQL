'use strict';

var assert = require('assert');
var nublox = require('..');

async function main() {
  var dialect = process.env.NUBLOX_DIALECT || 'postgresql';
  if (dialect !== 'postgresql') throw new Error('ddl-v5 live qualification is PostgreSQL-specific');
  var db = nublox.createClient({ dialect: 'postgresql', host: process.env.PGHOST || '127.0.0.1', port: Number(process.env.PGPORT || 5432), user: process.env.PGUSER, password: process.env.PGPASSWORD, database: process.env.PGDATABASE, pool: { max: 2 } });
  var model = nublox.capabilityModel;
  var table = 'nublox_compiler_ddl_v5';
  var view = table + '_view';
  var index = table + '_idx';
  try {
    await db.execute('DROP VIEW IF EXISTS ' + view);
    await db.execute('DROP TABLE IF EXISTS ' + table + ' CASCADE');
    var qualification = await model.qualifyClient(db);
    function compile(source) {
      var result = model.transpileSql('postgresql', 'postgresql', source, { sourceQualification: qualification, targetQualification: qualification });
      assert.strictEqual(result.scope, 'ddl-v5');
      assert.strictEqual(result.certified, true);
      return result.sql;
    }

    await db.execute('CREATE TABLE ' + table + ' (id INTEGER PRIMARY KEY, code VARCHAR(20))');
    await db.execute(compile('CREATE INDEX CONCURRENTLY ' + index + ' ON ' + table + ' (code)'));
    var indexed = await db.all("SELECT indexname FROM pg_indexes WHERE tablename = '" + table + "' AND indexname = '" + index + "'");
    assert.strictEqual(indexed.length, 1);

    await db.execute(compile('DROP INDEX CONCURRENTLY ' + index + ' RESTRICT'));
    var removed = await db.all("SELECT indexname FROM pg_indexes WHERE tablename = '" + table + "' AND indexname = '" + index + "'");
    assert.strictEqual(removed.length, 0);

    await db.execute('CREATE VIEW ' + view + ' AS SELECT id FROM ' + table);
    await db.execute(compile('DROP TABLE ' + table + ' CASCADE'));
    var viewCount = await db.one("SELECT count(*) AS n FROM pg_views WHERE viewname = '" + view + "'");
    assert.strictEqual(Number(viewCount.n), 0);

    assert.throws(function () {
      model.transpileSql('postgresql', 'mysql', 'DROP TABLE t CASCADE');
    }, /PostgreSQL-only/);
  } finally {
    try { await db.execute('DROP VIEW IF EXISTS ' + view); } catch (_) {}
    try { await db.execute('DROP INDEX CONCURRENTLY IF EXISTS ' + index); } catch (_) {}
    try { await db.execute('DROP TABLE IF EXISTS ' + table + ' CASCADE'); } catch (_) {}
    await db.close();
  }
  console.log('NuBloxSQL Wave 5e live dependency/concurrent index qualification: PASS for postgresql');
}

main().catch(function (error) { console.error(error && error.stack ? error.stack : error); process.exitCode = 1; });
