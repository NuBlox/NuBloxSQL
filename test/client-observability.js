'use strict';

var assert = require('assert');
var nublox = require('..');

async function main() {
  var events = [];
  var db = nublox.createClient({
    dialect: 'sqlite',
    filename: ':memory:',
    pool: false,
    telemetry: {
      slowQueryThresholdMs: 0,
      onEvent: function (event) { events.push(event); }
    }
  });

  await db.execute('CREATE TABLE telemetry_test (id INTEGER PRIMARY KEY, name TEXT NOT NULL)');
  await db.execute(nublox.sql`INSERT INTO telemetry_test (id, name) VALUES (${1}, ${'secret-name'})`);
  var row = await db.one(nublox.sql`SELECT id, name FROM telemetry_test WHERE id = ${1}`);
  assert.strictEqual(row.name, 'secret-name');

  var prepared = await db.prepare(nublox.sql`SELECT name FROM telemetry_test WHERE id = ${nublox.sql.parameter('id')}`);
  assert.strictEqual((await prepared.one({ id: 1 })).name, 'secret-name');
  await prepared.close();

  await db.transaction(async function (tx) {
    await tx.execute(nublox.sql`UPDATE telemetry_test SET name = ${'changed'} WHERE id = ${1}`);
  });

  var streamed = [];
  for await (var item of db.stream('SELECT id, name FROM telemetry_test ORDER BY id')) streamed.push(item);
  assert.strictEqual(streamed.length, 1);

  await assert.rejects(db.execute('INSERT INTO telemetry_test (id, name) VALUES (1, \'duplicate\')'));
  await db.close();

  assert.ok(events.length > 0);
  events.forEach(function (event) {
    assert.ok(Object.isFrozen(event));
    assert.strictEqual(event.dialect, 'sqlite');
    assert.strictEqual(typeof event.timestamp, 'number');
    assert.strictEqual(typeof event.id, 'number');
    assert.strictEqual(Object.prototype.hasOwnProperty.call(event, 'sql'), false, 'SQL text must be opt-in');
  });

  var finishes = events.filter(function (event) { return event.phase === 'finish'; });
  assert.ok(finishes.some(function (event) { return event.type === 'execute' && event.success === true; }));
  assert.ok(finishes.some(function (event) { return event.type === 'query' && event.success === true && event.rowCount === 1; }));
  assert.ok(finishes.some(function (event) { return event.type === 'transaction' && event.success === true; }));
  assert.ok(finishes.some(function (event) { return event.type === 'prepared' && event.success === true; }));
  assert.ok(finishes.some(function (event) { return event.type === 'stream' && event.success === true && event.rowCount === 1; }));
  assert.ok(finishes.some(function (event) { return event.slow === true; }));
  assert.ok(events.some(function (event) { return event.type === 'error' && event.success === false; }));

  var sqlEvents = [];
  var dbWithSql = nublox.createClient({
    dialect: 'sqlite',
    filename: ':memory:',
    pool: false,
    telemetry: {
      includeSql: true,
      onEvent: function (event) { sqlEvents.push(event); }
    }
  });
  await dbWithSql.query(nublox.sql`SELECT ${'classified-value'} AS value`);
  await dbWithSql.close();
  var captured = sqlEvents.find(function (event) { return event.sql; });
  assert.ok(captured);
  assert.ok(/SELECT \? AS value/.test(captured.sql));
  assert.strictEqual(captured.sql.indexOf('classified-value'), -1, 'bound values must never be emitted');

  console.log('NuBloxSQL portable observability contract passed');
}

main().catch(function (error) {
  console.error(error.stack || error);
  process.exitCode = 1;
});
