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
  throw new Error('Unsupported ddl-v3 live dialect: ' + dialect);
}

async function main() {
  var dialect = process.env.NUBLOX_DIALECT || 'sqlite';
  var db = nublox.createClient(configFor(dialect));
  var model = nublox.capabilityModel;
  var table = 'nublox_compiler_ddl_v3';

  try {
    await db.execute('DROP TABLE IF EXISTS ' + table);
    await db.execute('CREATE TABLE ' + table + ' (id INTEGER PRIMARY KEY, amount INTEGER, code VARCHAR(20))');
    var qualification = await model.qualifyClient(db);

    if (dialect === 'sqlite') {
      assert.throws(function () {
        model.transpileSql('postgresql', 'sqlite', 'ALTER TABLE ' + table + ' ALTER COLUMN amount SET DEFAULT 7', { targetQualification: qualification });
      }, /unsupported target capabilities/);
      console.log('NuBloxSQL Wave 5c live ddl-v3 fail-closed qualification: PASS for sqlite');
      return;
    }

    function compile(source) {
      var result = model.transpileSql('postgresql', dialect, source, { targetQualification: qualification });
      assert.strictEqual(result.scope, 'ddl-v3');
      assert.strictEqual(result.certified, true);
      return result.sql;
    }

    await db.execute(compile('ALTER TABLE ' + table + ' ALTER COLUMN amount SET DEFAULT 7'));
    await db.execute("INSERT INTO " + table + " (id, code) VALUES (1, 'alpha')");
    var defaulted = await db.one('SELECT amount FROM ' + table + ' WHERE id = 1');
    assert.strictEqual(Number(defaulted.amount), 7);

    await db.execute(compile('ALTER TABLE ' + table + ' ALTER COLUMN amount DROP DEFAULT'));

    if (dialect === 'postgresql') {
      await db.execute(compile('ALTER TABLE ' + table + ' ALTER COLUMN amount TYPE BIGINT'));
      await db.execute("UPDATE " + table + " SET code = 'alpha' WHERE id = 1");
      await db.execute(compile('ALTER TABLE ' + table + ' ALTER COLUMN code SET NOT NULL'));
      await db.execute(compile('ALTER TABLE ' + table + ' ADD CONSTRAINT nublox_amount_nonnegative CHECK (amount >= 0)'));

      var rejected = false;
      try { await db.execute("INSERT INTO " + table + " (id, amount, code) VALUES (2, -1, 'bad')"); }
      catch (_) { rejected = true; }
      assert.strictEqual(rejected, true, 'PostgreSQL CHECK constraint must reject negative amount');

      await db.execute(compile('ALTER TABLE ' + table + ' DROP CONSTRAINT nublox_amount_nonnegative'));
      await db.execute(compile('ALTER TABLE ' + table + ' ALTER COLUMN code DROP NOT NULL'));
      await db.execute("INSERT INTO " + table + " (id, amount, code) VALUES (3, 1, NULL)");
      var nullable = await db.one('SELECT code FROM ' + table + ' WHERE id = 3');
      assert.strictEqual(nullable.code, null);
    }
  } finally {
    try { await db.execute('DROP TABLE IF EXISTS ' + table); } catch (_) {}
    await db.close();
  }

  console.log('NuBloxSQL Wave 5c live ALTER COLUMN/constraint qualification: PASS for ' + dialect);
}

main().catch(function (error) {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
