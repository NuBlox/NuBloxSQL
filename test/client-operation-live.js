'use strict';

var assert = require('assert');
var nublox = require('..');

function configFor(dialect) {
  if (dialect === 'mysql') return {
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
  if (dialect === 'postgresql') return {
    dialect: 'postgresql',
    host: process.env.PGHOST || '127.0.0.1',
    port: Number(process.env.PGPORT || 5432),
    user: process.env.PGUSER,
    password: process.env.PGPASSWORD,
    database: process.env.PGDATABASE,
    pool: { max: 2 }
  };
  throw new Error('Unsupported dialect: ' + dialect);
}

async function expectCategory(promise, category) {
  await assert.rejects(promise, function (error) {
    assert.ok(error instanceof nublox.NuBloxSqlError);
    assert.strictEqual(error.category, category);
    return true;
  });
}

async function main() {
  var dialect = process.env.NUBLOX_DIALECT;
  if (!dialect) throw new Error('NUBLOX_DIALECT is required');
  var db = nublox.createClient(configFor(dialect));
  var slowSql = dialect === 'mysql' ? 'SELECT SLEEP(2)' : 'SELECT pg_sleep(2)';

  try {
    await expectCategory(db.query(slowSql, { timeout: 100 }), 'timeout');

    var deadline = Date.now() + 100;
    await expectCategory(db.query(slowSql, { deadline: deadline }), 'timeout');

    var controller = new AbortController();
    var pending = db.query(slowSql, { signal: controller.signal });
    setTimeout(function () { controller.abort(); }, 100);
    await expectCategory(pending, 'cancelled');

    var healthy = await db.query('SELECT 1 AS value');
    assert.strictEqual(Number(healthy.rows[0].value), 1);
    console.log('NuBloxSQL live portable operation control passed for ' + dialect);
  } finally {
    await db.close();
  }
}

main().catch(function (error) {
  console.error(error.stack || error);
  process.exitCode = 1;
});