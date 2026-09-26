'use strict';

var assert = require('assert');
var mysql = require('../../promise');

var config = {
  host        : process.env.MYSQL_HOST || '127.0.0.1',
  port        : Number(process.env.MYSQL_PORT || 3306),
  user        : process.env.MYSQL_USER || 'nublox',
  password    : process.env.MYSQL_PASSWORD || 'nublox_ci_password',
  database    : process.env.MYSQL_DATABASE || 'nublox_ci',
  dateStrings : true
};
var connection = mysql.createConnection(config);

connection.connect()
  .then(function () {
    return connection.execute(
      'SELECT CAST(? AS DATE) AS date_value, CAST(? AS DATETIME(6)) AS datetime_value, ' +
      'CAST(? AS DATETIME(6)) AS timestamp_value, CAST(? AS TIME(6)) AS time_value, ' +
      'JSON_UNQUOTE(JSON_EXTRACT(?, \'$.name\')) AS json_name, JSON_EXTRACT(?, \'$.count\') AS json_count',
      [
        mysql.param.date('2026-09-27'),
        mysql.param.datetime('2026-09-27 00:17:38.123456'),
        mysql.param.timestamp('2026-09-27 00:17:38.654321'),
        mysql.param.time('-120:19:27.000001'),
        mysql.param.json({name: 'NuBloxSQL', count: 7}),
        mysql.param.json({name: 'NuBloxSQL', count: 7})
      ]
    );
  })
  .then(function (result) {
    var row = result[0][0];

    assert.strictEqual(row.date_value, '2026-09-27');
    assert.strictEqual(row.datetime_value, '2026-09-27 00:17:38.123456');
    assert.strictEqual(row.timestamp_value, '2026-09-27 00:17:38.654321');
    assert.strictEqual(row.time_value, '-120:19:27.000001');
    assert.strictEqual(row.json_name, 'NuBloxSQL');
    assert.strictEqual(row.json_count, 7);

    return connection.end();
  })
  .catch(function (error) {
    connection.end().catch(function () {}).then(function () {
      process.nextTick(function () {
        throw error;
      });
    });
  });
