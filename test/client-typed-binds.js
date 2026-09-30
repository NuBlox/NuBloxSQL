'use strict';

var assert = require('assert');
var nublox = require('..');
var sql = nublox.sql;

async function main() {
  var decimal = sql.typed('123.4', { type: 'decimal', precision: 6, scale: 2 });
  assert.strictEqual(decimal.spec.type, 'decimal');
  assert.strictEqual(decimal.spec.precision, 6);
  assert.strictEqual(decimal.spec.scale, 2);
  assert.strictEqual(decimal.value, '123.40');

  assert.strictEqual(sql.typed('0.123', { type: 'decimal', precision: 3, scale: 3 }).value, '0.123');
  assert.strictEqual(sql.typed(123n, { type: 'numeric', precision: 3, scale: 0 }).value, '123');
  assert.strictEqual(sql.typed('-0.00', { type: 'decimal', precision: 2, scale: 2 }).value, '0.00');
  assert.strictEqual(sql.typed(null, { type: 'decimal', precision: 10, scale: 2 }).value, null);
  assert.throws(function () { sql.typed(1.2, { type: 'decimal', precision: 3, scale: 1 }); }, /strings, bigint, or null/);
  assert.throws(function () { sql.typed('1.234', { type: 'decimal', precision: 3, scale: 2 }); }, /exceeds configured scale/);
  assert.throws(function () { sql.typed('12.34', { type: 'decimal', precision: 3, scale: 2 }); }, /exceeds configured precision/);
  assert.throws(function () { sql.typed('1e3', { type: 'decimal', precision: 4, scale: 0 }); }, /plain decimal notation/);
  assert.throws(function () { sql.typed('1', { type: 'decimal', precision: 39, scale: 0 }); }, /precision must be/);

  var uuid = sql.typed('{00112233-4455-6677-8899-AABBCCDDEEFF}', 'guid');
  assert.strictEqual(uuid.spec.type, 'uuid');
  assert.strictEqual(uuid.value, '00112233-4455-6677-8899-aabbccddeeff');
  assert.strictEqual(sql.typed('00112233445566778899aabbccddeeff', 'uuid').value, uuid.value);
  assert.strictEqual(sql.typed(null, 'uuid').value, null);
  assert.throws(function () { sql.typed('not-a-uuid', 'uuid'); }, /valid 128-bit UUID/);

  var mysql = nublox.createClient({ dialect: 'mysql', user: 'test', pool: false });
  var mysqlCompiled = mysql.compile(sql`SELECT ${decimal} AS exact_decimal, ${uuid} AS typed_uuid`);
  assert.strictEqual(mysqlCompiled.text, 'SELECT ? AS exact_decimal, ? AS typed_uuid');
  assert.strictEqual(mysqlCompiled.parameters[0].spec.type, 'decimal');
  assert.strictEqual(mysqlCompiled.parameters[1].spec.type, 'uuid');

  var postgresql = nublox.createClient({ dialect: 'postgresql', user: 'test', pool: false });
  var pgCompiled = postgresql.compile(sql`SELECT ${decimal} AS exact_decimal, ${uuid} AS typed_uuid`);
  assert.strictEqual(pgCompiled.text, 'SELECT $1 AS exact_decimal, $2 AS typed_uuid');
  assert.strictEqual(postgresql.descriptor.services.parameterTypeOid(decimal.spec), 1700);
  assert.strictEqual(postgresql.descriptor.services.parameterTypeOid(uuid.spec), 2950);

  var seenType = null;
  var db = nublox.createClient({
    dialect: 'sqlite',
    filename: ':memory:',
    types: {
      encode: function encode(value, context) {
        if (context.type) seenType = context.type;
        return value;
      }
    }
  });

  var direct = await db.one(sql`
    SELECT
      ${sql.typed('12345678901234567890.123456', { type: 'decimal', precision: 26, scale: 6 })} AS exact_decimal,
      ${sql.typed('00112233-4455-6677-8899-AABBCCDDEEFF', 'uuid')} AS typed_uuid
  `);
  assert.strictEqual(direct.exact_decimal, '12345678901234567890.123456');
  assert.strictEqual(direct.typed_uuid, '00112233-4455-6677-8899-aabbccddeeff');
  assert.ok(seenType);

  var prepared = await db.prepare(sql`
    SELECT
      ${sql.parameter('amount', { type: 'decimal', precision: 10, scale: 4 })} AS exact_decimal,
      ${sql.parameter('id', 'uuid')} AS typed_uuid
  `);
  var preparedRow = await prepared.one({
    amount: '123.45',
    id: '00112233445566778899AABBCCDDEEFF'
  });
  assert.strictEqual(preparedRow.exact_decimal, '123.4500');
  assert.strictEqual(preparedRow.typed_uuid, '00112233-4455-6677-8899-aabbccddeeff');
  await prepared.close();

  var streamed = [];
  for await (var row of db.stream(sql`
    SELECT ${sql.typed('9.5', { type: 'decimal', precision: 4, scale: 2 })} AS amount
  `)) streamed.push(row);
  assert.deepStrictEqual(streamed, [{ amount: '9.50' }]);

  await db.close();
  console.log('NuBloxSQL portable typed decimal/UUID bind contract passed');
}

main().catch(function (error) {
  console.error(error.stack || error);
  process.exitCode = 1;
});
