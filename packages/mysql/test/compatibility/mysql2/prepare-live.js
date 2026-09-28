'use strict';

var assert = require('assert');
var path = require('path');

var mysql2 = require('mysql2/promise');
var nubloxCallback = require(path.resolve(__dirname, '../../..'));
var nublox = require(path.resolve(__dirname, '../../../promise'));

var config = {
  host     : process.env.MYSQL_HOST || '127.0.0.1',
  port     : Number(process.env.MYSQL_PORT || 3306),
  user     : process.env.MYSQL_USER || 'root',
  password : process.env.MYSQL_PASSWORD || '',
  database : process.env.MYSQL_DATABASE || undefined
};
var mysql2Connection;
var nubloxConnection;
var callbackConnection;
var pool;

function comparable(value) {
  return JSON.parse(JSON.stringify(value));
}

function callbackPrepare(connection, sql) {
  return new global.Promise(function (resolve, reject) {
    connection.prepare(sql, function (error, statement) {
      if (error) {
        reject(error);
        return;
      }
      resolve(statement);
    });
  });
}

function callbackExecute(statement, values) {
  return new global.Promise(function (resolve, reject) {
    statement.execute(values, function (error, rows, fields) {
      if (error) {
        reject(error);
        return;
      }
      resolve([rows, fields]);
    });
  });
}

function cleanup() {
  var tasks = [];

  if (pool) {
    tasks.push(new global.Promise(function (resolve) {
      pool.end(function () { resolve(); });
    }));
  }
  if (callbackConnection) {
    tasks.push(new global.Promise(function (resolve) {
      callbackConnection.end(function () { resolve(); });
    }));
  }
  if (nubloxConnection) tasks.push(nubloxConnection.end().catch(function () {}));
  if (mysql2Connection) tasks.push(mysql2Connection.end().catch(function () {}));

  return global.Promise.all(tasks);
}

function runPromiseParity() {
  nubloxConnection = nublox.createConnection(config);

  return nubloxConnection.connect()
    .then(function () {
      return mysql2.createConnection(config);
    })
    .then(function (connection) {
      mysql2Connection = connection;
      return global.Promise.all([
        nubloxConnection.prepare('SELECT ? + ? AS total, ? AS label'),
        mysql2Connection.prepare('SELECT ? + ? AS total, ? AS label')
      ]);
    })
    .then(function (statements) {
      var nubloxStatement = statements[0];
      var mysql2Statement = statements[1];

      assert.strictEqual(typeof nubloxStatement.execute, 'function');
      assert.strictEqual(typeof nubloxStatement.close, 'function');
      assert.strictEqual(nubloxStatement.query, mysql2Statement.statement.query);
      assert.strictEqual(nubloxStatement.parameters.length, mysql2Statement.statement.parameters.length);
      assert.strictEqual(nubloxStatement.columns.length, mysql2Statement.statement.columns.length);

      return global.Promise.all([
        nubloxStatement.execute([20, 22, 'manual']),
        mysql2Statement.execute([20, 22, 'manual'])
      ]).then(function (results) {
        assert.deepStrictEqual(comparable(results[0][0]), comparable(results[1][0]));
        return nubloxStatement.close().then(function () {
          return mysql2Statement.close();
        }).then(function () {
          return nubloxStatement.execute([1, 2, 'closed']).then(function () {
            throw new Error('Closed NuBlox statement unexpectedly executed');
          }, function (error) {
            assert.strictEqual(error.code, 'PREPARED_STATEMENT_CLOSED');
          });
        });
      });
    });
}

function runCallbackParity() {
  callbackConnection = nubloxCallback.createConnection(config);

  return callbackPrepare(callbackConnection, 'SELECT ? AS callback_value')
    .then(function (statement) {
      assert.strictEqual(typeof statement.id, 'number');
      assert.strictEqual(statement.query, 'SELECT ? AS callback_value');
      assert.strictEqual(statement.parameters.length, 1);
      return callbackExecute(statement, ['ok']).then(function (result) {
        assert.strictEqual(result[0][0].callback_value, 'ok');
        statement.close();
      });
    });
}

function runPoolAcquiredConnectionParity() {
  pool = nubloxCallback.createPool(Object.assign({connectionLimit: 1}, config));

  return new global.Promise(function (resolve, reject) {
    pool.getConnection(function (error, connection) {
      if (error) {
        reject(error);
        return;
      }

      assert.strictEqual(typeof connection.execute, 'function');
      assert.strictEqual(typeof connection.prepare, 'function');

      connection.prepare('SELECT ? AS pooled_manual', function (prepareError, statement) {
        if (prepareError) {
          connection.release();
          reject(prepareError);
          return;
        }

        statement.execute(['pool'], function (executeError, rows) {
          statement.close();
          connection.release();

          if (executeError) {
            reject(executeError);
            return;
          }

          assert.strictEqual(rows[0].pooled_manual, 'pool');
          resolve();
        });
      });
    });
  });
}

runPromiseParity()
  .then(runCallbackParity)
  .then(runPoolAcquiredConnectionParity)
  .then(cleanup)
  .catch(function (error) {
    cleanup().then(function () {
      process.nextTick(function () {
        throw error;
      });
    });
  });
