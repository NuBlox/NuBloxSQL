'use strict';

var assert = require('assert');
var mysql = require('../../promise');

var config = {
  host                    : process.env.MYSQL_HOST || '127.0.0.1',
  port                    : Number(process.env.MYSQL_PORT || 3306),
  user                    : process.env.MYSQL_USER || 'nublox',
  password                : process.env.MYSQL_PASSWORD || 'nublox_ci_password',
  database                : process.env.MYSQL_DATABASE || 'nublox_ci',
  allowPublicKeyRetrieval : true
};
var connection = mysql.createConnection(config);
var pool;

connection.connect()
  .then(function () {
    return connection.query('SELECT 1 AS value, CURRENT_USER() AS currentUser, VERSION() AS version');
  })
  .then(function (queryResult) {
    var rows = queryResult[0];

    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].value, 1);
    assert.ok(rows[0].currentUser);
    assert.ok(rows[0].version);

    return connection.end();
  })
  .then(function () {
    pool = mysql.createPool(Object.assign({}, config, {
      connectionLimit: 2
    }));

    return pool.healthCheck();
  })
  .then(function (health) {
    assert.strictEqual(health.ok, true);

    return pool.withTransaction(function (transaction) {
      return transaction.query('SELECT 2 AS value').then(function (result) {
        return result[0][0].value;
      });
    });
  })
  .then(function (value) {
    assert.strictEqual(value, 2);
    return pool.end();
  })
  .catch(function (err) {
    process.nextTick(function () {
      throw err;
    });
  });
