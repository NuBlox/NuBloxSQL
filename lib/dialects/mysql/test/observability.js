'use strict';

var assert = require('assert');
var diagnosticsChannel = require('diagnostics_channel');
var mysql = require('..');

async function collect(channelName, run) {
  var messages = [];
  var channel = diagnosticsChannel.channel(channelName);
  function onMessage(message) { messages.push(message); }
  channel.subscribe(onMessage);
  try {
    await run();
  } finally {
    channel.unsubscribe(onMessage);
  }
  return messages;
}

async function testChannelNames() {
  assert.deepStrictEqual(mysql.OBSERVABILITY_CHANNELS, {
    connection: 'nublox.mysql.connection',
    statement: 'nublox.mysql.statement',
    pool: 'nublox.mysql.pool'
  });
}

async function testConnectionErrorTelemetryDoesNotLeakSql() {
  var connection = mysql.createConnection({ user: 'test' });
  var secretSql = 'SELECT "do-not-leak-this-sql"';
  var messages = await collect(mysql.OBSERVABILITY_CHANNELS.connection, async function () {
    await assert.rejects(connection.query(secretSql), /not ready/);
  });

  assert.strictEqual(messages.length, 2);
  assert.strictEqual(messages[0].phase, 'start');
  assert.strictEqual(messages[0].operation, 'query');
  assert.match(messages[0].targetId, /^conn-/);
  assert.strictEqual(messages[1].phase, 'error');
  assert.strictEqual(messages[1].operation, 'query');
  assert.ok(messages[1].durationMs >= 0);
  assert.strictEqual(JSON.stringify(messages).includes('do-not-leak-this-sql'), false);
  assert.strictEqual(JSON.stringify(messages).includes('password'), false);
}

async function testPreparedStatementTelemetry() {
  var connection = mysql.createConnection({ user: 'test' });
  var statement = new mysql.PreparedStatement(connection, {
    statementId: 42,
    numParams: 0,
    numColumns: 0,
    warningCount: 0,
    parameters: [],
    columns: []
  });
  var messages = await collect(mysql.OBSERVABILITY_CHANNELS.statement, async function () {
    await assert.rejects(statement.execute([]), /not ready/);
  });

  assert.strictEqual(messages.length, 2);
  assert.strictEqual(messages[0].phase, 'start');
  assert.strictEqual(messages[0].operation, 'execute');
  assert.strictEqual(messages[0].details.statementId, 42);
  assert.match(messages[0].details.connectionId, /^conn-/);
  assert.strictEqual(messages[1].phase, 'error');
}

async function testPoolTelemetry() {
  var pool = mysql.createPool({ user: 'test', connectionLimit: 1, acquireTimeout: 25 });
  var messages = await collect(mysql.OBSERVABILITY_CHANNELS.pool, async function () {
    await pool.end();
  });

  assert.strictEqual(messages.length, 2);
  assert.strictEqual(messages[0].phase, 'start');
  assert.strictEqual(messages[0].operation, 'end');
  assert.match(messages[0].targetId, /^pool-/);
  assert.strictEqual(messages[1].phase, 'success');
}

Promise.resolve()
  .then(testChannelNames)
  .then(testConnectionErrorTelemetryDoesNotLeakSql)
  .then(testPreparedStatementTelemetry)
  .then(testPoolTelemetry)
  .then(function () { console.log('ok - clean-room observability contract'); })
  .catch(function (error) {
    console.error(error.stack || error);
    process.exitCode = 1;
  });
