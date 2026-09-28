'use strict';

var assert = require('assert');
var Diagnostics = require('diagnostics_channel');
var mysql = require('../../promise');

var channel = Diagnostics.channel('nublox.mysql.stream.backpressure');
var events = [];
var listener = function listener(event) {
  events.push(event);
};
var connection = mysql.createConnection({
  host     : process.env.MYSQL_HOST || '127.0.0.1',
  port     : Number(process.env.MYSQL_PORT || 3306),
  user     : process.env.MYSQL_USER || 'nublox',
  password : process.env.MYSQL_PASSWORD || 'nublox_ci_password',
  database : process.env.MYSQL_DATABASE || 'nublox_ci'
});
var count = 0;
var settled = false;

channel.subscribe(listener);

var stream = connection.stream(
  'WITH RECURSIVE seq AS (' +
    'SELECT 1 AS n UNION ALL SELECT n + 1 FROM seq WHERE n < 64' +
  ') SELECT n FROM seq ORDER BY n',
  [],
  {highWaterMark: 1}
);

assert.strictEqual(stream.readableObjectMode, true);
assert.strictEqual(stream.readableHighWaterMark, 1);

stream.on('error', finish);
stream.on('end', function () {
  try {
    assert.strictEqual(count, 64);
    assert.ok(events.some(function (event) { return event.action === 'pause'; }));
    assert.ok(events.some(function (event) { return event.action === 'resume'; }));
    finish();
  } catch (error) {
    finish(error);
  }
});

setTimeout(function () {
  stream.on('data', function (row) {
    count++;
    assert.strictEqual(Number(row.n), count);
  });
}, 25);

function finish(error) {
  if (settled) {
    return;
  }

  settled = true;
  channel.unsubscribe(listener);

  connection.end().catch(function () {})
    .then(function () {
      if (error) {
        process.nextTick(function () {
          throw error;
        });
      }
    });
}
