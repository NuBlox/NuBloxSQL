'use strict';

var assert = require('assert');
var path = require('path');
var nublox = require(path.resolve(__dirname, '../../../promise'));

var config = {
  host     : process.env.MYSQL_HOST || '127.0.0.1',
  port     : Number(process.env.MYSQL_PORT || 3306),
  user     : process.env.MYSQL_USER || 'root',
  password : process.env.MYSQL_PASSWORD || '',
  database : process.env.MYSQL_DATABASE || undefined
};
var connection;

function cleanup() {
  return connection ? connection.end().catch(function () {}) : global.Promise.resolve();
}

function run() {
  connection = nublox.createConnection(config);

  return connection.connect()
    .then(function () {
      return connection.prepare('SELECT ? AS value');
    })
    .then(function (statement) {
      assert.strictEqual(typeof statement.reset, 'function');

      return statement.execute([1])
        .then(function (result) {
          assert.strictEqual(result[0][0].value, 1);
          return statement.reset();
        })
        .then(function (resetStatement) {
          assert.strictEqual(resetStatement, statement);
          return statement.execute([2]);
        })
        .then(function (result) {
          assert.strictEqual(result[0][0].value, 2);
          return statement.close();
        })
        .then(function () {
          return statement.reset().then(function () {
            throw new Error('reset() after close should reject');
          }, function (error) {
            assert.strictEqual(error.code, 'PREPARED_STATEMENT_CLOSED');
          });
        });
    })
    .then(function () {
      return connection.prepare('SELECT ? AS pooled_reset');
    })
    .then(function (statement) {
      return statement.reset()
        .then(function () { return statement.execute(['ok']); })
        .then(function (result) {
          assert.strictEqual(result[0][0].pooled_reset, 'ok');
          return statement.close();
        });
    })
    .then(cleanup);
}

run().catch(function (error) {
  cleanup().then(function () {
    process.nextTick(function () {
      throw error;
    });
  });
});
