'use strict';

var assert = require('assert');
var nublox = require('..');
var sql = nublox.sql;

async function main() {
  var encodeCalls = 0;
  var decodeCalls = 0;
  var db = nublox.createClient({
    dialect: 'sqlite',
    filename: ':memory:',
    pool: false,
    types: {
      encode: function (value, context) {
        encodeCalls += 1;
        assert.strictEqual(context.dialect, 'sqlite');
        if (value && value.__nubloxCodecValue) return value.value;
        return value;
      },
      columns: {
        name: function (value, context) {
          decodeCalls += 1;
          assert.strictEqual(context.column, 'name');
          assert.strictEqual(context.direction, 'decode');
          return String(value).toUpperCase();
        }
      }
    }
  });

  assert.ok(db.types instanceof nublox.TypeRegistry);
  await db.execute('CREATE TABLE codec_test (id INTEGER PRIMARY KEY, name TEXT NOT NULL)');
  await db.execute(sql`INSERT INTO codec_test (id, name) VALUES (${1}, ${{ __nubloxCodecValue: true, value: 'alpha' }})`);

  var row = await db.one(sql`SELECT id, name FROM codec_test WHERE id = ${1}`);
  assert.strictEqual(row.name, 'ALPHA');

  db.types.registerColumn('name', function (value) { return '[' + value + ']'; });
  row = await db.one('SELECT id, name FROM codec_test WHERE id = 1');
  assert.strictEqual(row.name, '[alpha]');

  var prepared = await db.prepare(sql`SELECT id, name FROM codec_test WHERE id = ${sql.parameter('id')}`);
  row = await prepared.one({ id: 1 });
  assert.strictEqual(row.name, '[alpha]');
  await prepared.close();

  var stream = db.stream('SELECT id, name FROM codec_test ORDER BY id');
  var streamed = [];
  for await (var item of stream) streamed.push(item);
  assert.strictEqual(streamed[0].name, '[alpha]');

  db.types.unregisterColumn('name');
  row = await db.one('SELECT id, name FROM codec_test WHERE id = 1');
  assert.strictEqual(row.name, 'alpha');

  assert.ok(encodeCalls > 0);
  assert.ok(decodeCalls > 0);
  await db.close();
  console.log('NuBloxSQL portable type codec contract passed');
}

main().catch(function (error) {
  console.error(error.stack || error);
  process.exitCode = 1;
});
