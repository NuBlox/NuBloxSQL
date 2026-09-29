'use strict';

var assert = require('assert');
var nublox = require('..');
var sql = nublox.sql;

function configFor(dialect) {
  var base;
  if (dialect === 'mysql') base = {
    dialect: 'mysql', host: process.env.MYSQL_HOST || '127.0.0.1', port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER, password: process.env.MYSQL_PASSWORD, database: process.env.MYSQL_DATABASE,
    ssl: 'disable', getServerPublicKey: true, pool: { max: 2 }
  };
  else if (dialect === 'postgresql') base = {
    dialect: 'postgresql', host: process.env.PGHOST || '127.0.0.1', port: Number(process.env.PGPORT || 5432),
    user: process.env.PGUSER, password: process.env.PGPASSWORD, database: process.env.PGDATABASE, pool: { max: 2 }
  };
  else throw new Error('Unsupported dialect: ' + dialect);

  base.types = {
    encode: function (value) {
      if (value && value.__codecProbe) return value.value;
      return value;
    },
    columns: {
      codec_probe: function (value, context) {
        assert.strictEqual(context.dialect, dialect);
        return String(value).toUpperCase();
      }
    }
  };
  return base;
}

async function main() {
  var dialect = process.env.NUBLOX_DIALECT;
  if (!dialect) throw new Error('NUBLOX_DIALECT is required');
  var db = nublox.createClient(configFor(dialect));
  try {
    var row = await db.one(sql`SELECT ${{ __codecProbe: true, value: 'portable' }} AS codec_probe`);
    assert.strictEqual(row.codec_probe, 'PORTABLE');

    db.types.registerColumn('codec_probe', function (value) { return '[' + value + ']'; });
    row = await db.one(sql`SELECT ${'native'} AS codec_probe`);
    assert.strictEqual(row.codec_probe, '[native]');

    var prepared = await db.prepare(sql`SELECT ${sql.parameter('value')} AS codec_probe`);
    row = await prepared.one({ value: { __codecProbe: true, value: 'prepared' } });
    assert.strictEqual(row.codec_probe, '[prepared]');
    await prepared.close();

    var stream = db.stream(sql`SELECT ${'stream'} AS codec_probe`);
    var item = await stream.next();
    assert.strictEqual(item.value.codec_probe, '[stream]');
    await stream.close();

    console.log('NuBloxSQL live portable type codec contract passed for ' + dialect);
  } finally {
    await db.close();
  }
}

main().catch(function (error) {
  console.error(error.stack || error);
  process.exitCode = 1;
});
