'use strict';

var assert = require('assert');
var mysql = require('../../promise');

var pool = mysql.createPool({
  host: process.env.MYSQL_HOST || '127.0.0.1',
  port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER || 'nublox',
  password: process.env.MYSQL_PASSWORD || 'nublox_ci_password',
  database: process.env.MYSQL_DATABASE || 'nublox_ci',
  connectionLimit: 4,
  minimumIdle: 2,
  maintainMinimumIdle: true,
  minimumIdleRetryDelayMs: 50,
  minimumIdleMaxRetryDelayMs: 200,
  minimumIdleRetryJitter: 0
});
var heldConnection;

assert.strictEqual(pool.stats().total, 0, 'maintenance must remain lazy until explicit warmup');

pool.warmup()
  .then(function (result) {
    assert.strictEqual(result.created, 2);
    assert.strictEqual(result.idle, 2);
    assert.strictEqual(result.total, 2);
    return pool.getConnection();
  })
  .then(function (connection) {
    heldConnection = connection;

    var stats = pool.stats();
    assert.strictEqual(stats.active, 1);
    assert.ok(stats.idle >= 1 && stats.idle <= 2);
    assert.ok(stats.total >= 2 && stats.total <= 3);

    return waitForIdle(pool, 2, 50);
  })
  .then(function (stats) {
    assert.strictEqual(stats.idle, 2);
    assert.strictEqual(stats.active, 1);
    assert.strictEqual(stats.total, 3);

    heldConnection.release();
    heldConnection = null;

    assert.strictEqual(pool.stats().idle, 3);
    return pool.end();
  })
  .catch(function (error) {
    if (heldConnection) {
      heldConnection.release();
      heldConnection = null;
    }

    pool.end().catch(function () {})
      .then(function () {
        process.nextTick(function () {
          throw error;
        });
      });
  });

function waitForIdle(targetPool, target, attempts) {
  return new targetPool.Promise(function (resolve, reject) {
    function check(remaining) {
      var stats = targetPool.stats();

      if (stats.idle >= target) {
        resolve(stats);
        return;
      }

      if (remaining <= 0) {
        reject(new Error('minimum-idle maintenance did not reach target'));
        return;
      }

      setTimeout(function () {
        check(remaining - 1);
      }, 20);
    }

    check(attempts);
  });
}
