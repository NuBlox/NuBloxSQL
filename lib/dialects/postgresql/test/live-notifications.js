'use strict';

var assert = require('assert');
var postgres = require('..');

function config() {
  return {
    host: process.env.PGHOST || '127.0.0.1',
    port: Number(process.env.PGPORT || 5432),
    user: process.env.PGUSER || 'postgres',
    password: process.env.PGPASSWORD || 'postgres',
    database: process.env.PGDATABASE || 'postgres',
    ssl: false,
    connectTimeout: 10000
  };
}

function nextNotification(emitter, timeout) {
  return new Promise(function (resolve, reject) {
    var timer = setTimeout(function () {
      cleanup();
      reject(new Error('Timed out waiting for PostgreSQL notification'));
    }, timeout || 3000);
    function cleanup() {
      clearTimeout(timer);
      emitter.removeListener('notification', onNotification);
      emitter.removeListener('error', onError);
    }
    function onNotification(notification) { cleanup(); resolve(notification); }
    function onError(error) { cleanup(); reject(error); }
    emitter.once('notification', onNotification);
    emitter.once('error', onError);
  });
}

async function main() {
  var listener = postgres.createConnection(config());
  var notifier = postgres.createConnection(config());
  await Promise.all([listener.connect(), notifier.connect()]);

  assert.strictEqual(postgres.capabilities.asynchronousNotifications, true);

  var channel = 'nublox_notify_' + process.pid;
  await listener.listen(channel);

  var firstPending = nextNotification(listener);
  await notifier.notify(channel, 'hello');
  var first = await firstPending;
  assert.strictEqual(first.channel, channel);
  assert.strictEqual(first.payload, 'hello');
  assert.ok(Number.isInteger(first.processId) && first.processId > 0);
  assert.ok(Object.isFrozen(first));

  // NotificationResponse is asynchronous protocol traffic and must not disturb
  // an unrelated command already in flight on the listening connection.
  var duringQueryPending = nextNotification(listener);
  var sleeper = listener.query('SELECT pg_sleep(0.2), 42::int4 AS value');
  await new Promise(function (resolve) { setTimeout(resolve, 50); });
  await notifier.notify(channel, 'during-query');
  var second = await duringQueryPending;
  var queryResult = await sleeper;
  assert.strictEqual(second.payload, 'during-query');
  assert.strictEqual(queryResult.rows[0].value, 42);

  await listener.unlisten(channel);
  var receivedAfterUnlisten = false;
  function unexpected() { receivedAfterUnlisten = true; }
  listener.on('notification', unexpected);
  await notifier.notify(channel, 'ignored');
  await new Promise(function (resolve) { setTimeout(resolve, 100); });
  listener.removeListener('notification', unexpected);
  assert.strictEqual(receivedAfterUnlisten, false);

  await listener.end();
  await notifier.end();

  var pool = postgres.createPool(Object.assign(config(), { connectionLimit: 2, maxIdle: 2 }));
  var subscription = await pool.listen(channel);
  assert.ok(subscription instanceof postgres.NotificationSubscription);
  assert.strictEqual(pool.borrowedCount, 1);
  var pooledPending = nextNotification(subscription);
  await pool.notify(channel, 'pooled');
  var pooled = await pooledPending;
  assert.strictEqual(pooled.channel, channel);
  assert.strictEqual(pooled.payload, 'pooled');
  assert.strictEqual(pool.borrowedCount, 1);
  await subscription.close();
  assert.strictEqual(subscription.closed, true);
  assert.strictEqual(pool.borrowedCount, 0);

  var check = await pool.query('SELECT 7::int4 AS value');
  assert.strictEqual(check.rows[0].value, 7);
  await pool.end();

  console.log('NuBloxSQL PostgreSQL LISTEN/NOTIFY qualification passed');
}

main().catch(function (error) {
  console.error(error && error.stack || error);
  process.exitCode = 1;
});
