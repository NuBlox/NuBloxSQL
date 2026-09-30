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

  var uuid = sql.typed('{00112233-4455-6677-8899-AABBCCDDEEFF}', 'guid');
  assert.strictEqual(uuid.spec.type, 'uuid');
  assert.strictEqual(uuid.value, '00112233-4455-6677-8899-aabbccddeeff');
  assert.throws(function () { sql.typed('not-a-uuid', 'uuid'); }, /valid 128-bit UUID/);

  var date = sql.typed('2028-02-29', 'date');
  var time = sql.typed('09:07:05.12', { type: 'time', scale: 6 });
  var timestamp = sql.typed('2026-09-30T13:25:14.123', { type: 'datetime', scale: 6 });
  assert.strictEqual(date.value, '2028-02-29');
  assert.strictEqual(time.value, '09:07:05.120000');
  assert.strictEqual(timestamp.spec.type, 'timestamp');
  assert.strictEqual(timestamp.value, '2026-09-30 13:25:14.123000');
  assert.strictEqual(sql.typed('12:34:56', { type: 'time', scale: 0 }).value, '12:34:56');
  assert.throws(function () { sql.typed('2026-02-29', 'date'); }, /Gregorian calendar range/);
  assert.throws(function () { sql.typed('24:00:00', 'time'); }, /time-of-day range/);
  assert.throws(function () { sql.typed('12:00:00.123', { type: 'time', scale: 2 }); }, /exceeds configured scale/);
  assert.throws(function () { sql.typed(new Date(), 'timestamp'); }, /timestamp values must be strings or null/);

  var mysql = nublox.createClient({ dialect: 'mysql', user: 'test', pool: false });
  var mysqlCompiled = mysql.compile(sql`SELECT ${decimal}, ${uuid}, ${date}, ${time}, ${timestamp}`);
  assert.strictEqual(mysqlCompiled.text, 'SELECT ?, ?, ?, ?, ?');
  assert.strictEqual(mysqlCompiled.parameters[4].spec.type, 'timestamp');

  var postgresql = nublox.createClient({ dialect: 'postgresql', user: 'test', pool: false });
  assert.strictEqual(postgresql.descriptor.services.parameterTypeOid(decimal.spec), 1700);
  assert.strictEqual(postgresql.descriptor.services.parameterTypeOid(uuid.spec), 2950);
  assert.strictEqual(postgresql.descriptor.services.parameterTypeOid(date.spec), 1082);
  assert.strictEqual(postgresql.descriptor.services.parameterTypeOid(time.spec), 1083);
  assert.strictEqual(postgresql.descriptor.services.parameterTypeOid(timestamp.spec), 1114);

  var seenType = null;
  var db = nublox.createClient({ dialect: 'sqlite', filename: ':memory:', types: { encode: function (value, context) { if (context.type) seenType = context.type; return value; } } });
  var direct = await db.one(sql`SELECT ${date} AS d, ${time} AS t, ${timestamp} AS ts`);
  assert.strictEqual(direct.d, '2028-02-29');
  assert.strictEqual(direct.t, '09:07:05.120000');
  assert.strictEqual(direct.ts, '2026-09-30 13:25:14.123000');
  assert.ok(seenType);

  var prepared = await db.prepare(sql`SELECT ${sql.parameter('d','date')} AS d, ${sql.parameter('t',{type:'time',scale:3})} AS t, ${sql.parameter('ts',{type:'timestamp',scale:6})} AS ts`);
  var preparedRow = await prepared.one({ d:'2024-02-29', t:'01:02:03.4', ts:'2024-02-29 01:02:03.4' });
  assert.strictEqual(preparedRow.d, '2024-02-29');
  assert.strictEqual(preparedRow.t, '01:02:03.400');
  assert.strictEqual(preparedRow.ts, '2024-02-29 01:02:03.400000');
  await prepared.close();
  await db.close();
  console.log('NuBloxSQL portable exact decimal/UUID/temporal bind contract passed');
}

main().catch(function (error) { console.error(error.stack || error); process.exitCode = 1; });
