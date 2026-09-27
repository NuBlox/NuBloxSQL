'use strict';

var assert = require('assert');
var mysql = require('../../promise');

var pool = mysql.createPool({
  host            : process.env.MYSQL_HOST || '127.0.0.1',
  port            : Number(process.env.MYSQL_PORT || 3306),
  user            : process.env.MYSQL_USER || 'nublox',
  password        : process.env.MYSQL_PASSWORD || 'nublox_ci_password',
  database        : process.env.MYSQL_DATABASE || 'nublox_ci',
  connectionLimit : 4,
  minimumIdle     : 3
});
var heldConnection;

pool.warmup()
  .then(function (result) {
    assert.strictEqual(result.target, 3);
    assert.strictEqual(result.created, 3);
    assert.strictEqual(result.idle, 3);
    assert.strictEqual(result.total, 3);
    assert.strictEqual(result.limited, false);

    var stats = pool.stats();
    assert.strictEqual(stats.minimumIdle, 3);
    assert.strictEqual(stats.idle, 3);
    assert.strictEqual(stats.total, 3);
    assert.strictEqual(stats.active, 0);

    return pool.getConnection();
  })
  .then(function (connection) {
    heldConnection = connection;

    var stats = pool.stats();
    assert.strictEqual(stats.idle, 2);
    assert.strictEqual(stats.active, 1);

    return pool.warmup();
  })
  .then(function (result) {
    assert.strictEqual(result.target, 3);
    assert.strictEqual(result.created, 1);
    assert.strictEqual(result.idle, 3);
    assert.strictEqual(result.total, 4);
    assert.strictEqual(result.limited, false);

    heldConnection.release();
    heldConnection = null;

    assert.strictEqual(pool.stats().idle, 4);
    return pool.warmup(2);
  })
  .then(function (result) {
    assert.strictEqual(result.created, 0);
    assert.strictEqual(result.idle, 4);
    assert.strictEqual(result.total, 4);
    assert.strictEqual(result.limited, false);

    return pool.end();
  })
  .catch(function (error) {
    if (heldConnection) {
      heldConnection.release();
      heldConnection = null;
    }

    pool.end().catch(function () {}).then(function () {
      process.nextTick(function () {
        throw error;
      });
    });
  });
