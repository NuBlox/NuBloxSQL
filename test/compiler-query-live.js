'use strict';

var assert = require('assert');
var nublox = require('..');

function configFor(dialect) {
  if (dialect === 'postgresql') {
    return {
      dialect: 'postgresql',
      host: process.env.PGHOST || '127.0.0.1',
      port: Number(process.env.PGPORT || 5432),
      user: process.env.PGUSER,
      password: process.env.PGPASSWORD,
      database: process.env.PGDATABASE,
      pool: { max: 2 }
    };
  }
  if (dialect === 'mysql') {
    return {
      dialect: 'mysql',
      host: process.env.MYSQL_HOST || '127.0.0.1',
      port: Number(process.env.MYSQL_PORT || 3306),
      user: process.env.MYSQL_USER,
      password: process.env.MYSQL_PASSWORD,
      database: process.env.MYSQL_DATABASE,
      ssl: 'disable',
      getServerPublicKey: true,
      pool: { max: 2 }
    };
  }
  if (dialect === 'sqlite') return { dialect: 'sqlite', filename: ':memory:', pool: false };
  throw new Error('Unsupported compiler live dialect: ' + dialect);
}

function compile(dialect, source) {
  var result = nublox.capabilityModel.transpileSql('postgresql', dialect, source);
  assert.strictEqual(result.scope, 'select-query-v2');
  assert.strictEqual(result.certified, true);
  return result.sql;
}

async function main() {
  var dialect = process.env.NUBLOX_DIALECT || 'sqlite';
  var db = nublox.createClient(configFor(dialect));
  var table = 'nublox_compiler_query_wave';
  try {
    await db.execute('DROP TABLE IF EXISTS ' + table);
    await db.execute('CREATE TABLE ' + table + ' (id INTEGER PRIMARY KEY, parent_id INTEGER, name VARCHAR(100) NOT NULL)');
    await db.execute("INSERT INTO " + table + " (id, parent_id, name) VALUES (1, NULL, 'root')");
    await db.execute("INSERT INTO " + table + " (id, parent_id, name) VALUES (2, 1, 'child')");

    var cteSql = compile(dialect,
      'WITH scoped AS (SELECT id, parent_id FROM ' + table + ' WHERE id > 0) ' +
      'SELECT s.id FROM scoped s WHERE EXISTS (SELECT 1 FROM ' + table + ' x WHERE x.id = s.id) ' +
      'AND s.id IN (SELECT y.id FROM ' + table + ' y) ORDER BY s.id'
    );
    var cteRows = await db.all(cteSql);
    assert.deepStrictEqual(cteRows.map(function (row) { return Number(row.id); }), [1, 2]);

    var derivedSql = compile(dialect,
      'SELECT d.id, (SELECT max(x.id) FROM ' + table + ' x) AS max_id ' +
      'FROM (SELECT id FROM ' + table + ' WHERE id > 0) d ORDER BY d.id'
    );
    var derivedRows = await db.all(derivedSql);
    assert.strictEqual(derivedRows.length, 2);
    assert.strictEqual(Number(derivedRows[0].max_id), 2);
    assert.strictEqual(Number(derivedRows[1].max_id), 2);

    var recursiveDeclarationSql = compile(dialect,
      'WITH RECURSIVE scoped(id) AS (SELECT id FROM ' + table + ' WHERE id = 1) SELECT id FROM scoped'
    );
    var recursiveRows = await db.all(recursiveDeclarationSql);
    assert.strictEqual(recursiveRows.length, 1);
    assert.strictEqual(Number(recursiveRows[0].id), 1);
  } finally {
    try { await db.execute('DROP TABLE IF EXISTS ' + table); } catch (_) {}
    await db.close();
  }

  console.log('NuBloxSQL live compiler query wave: PASS for ' + dialect);
}

main().catch(function (error) {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
