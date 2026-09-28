'use strict';

var assert = require('assert');
var path = require('path');

var mysql2 = require('mysql2/promise');
var nublox = require(path.resolve(__dirname, '../../../promise'));

var config = {
  host     : process.env.MYSQL_HOST || '127.0.0.1',
  port     : Number(process.env.MYSQL_PORT || 3306),
  user     : process.env.MYSQL_USER || 'root',
  password : process.env.MYSQL_PASSWORD || '',
  database : process.env.MYSQL_DATABASE || undefined
};
var mysql2Connection;
var mysql2Pool;
var nubloxConnection = nublox.createConnection(config);
var nubloxPool;

function comparableRows(rows) {
  return JSON.parse(JSON.stringify(rows));
}

function fieldNames(fields) {
  return fields.map(function (field) {
    return field.name;
  });
}

function captureError(promise) {
  return promise.then(function () {
    assert.fail('expected query to fail');
  }, function (error) {
    return error;
  });
}

function cleanup() {
  var tasks = [];

  if (nubloxPool) {
    tasks.push(nubloxPool.end().catch(function () {}));
  }

  if (mysql2Pool) {
    tasks.push(mysql2Pool.end().catch(function () {}));
  }

  if (nubloxConnection) {
    tasks.push(nubloxConnection.end().catch(function () {}));
  }

  if (mysql2Connection) {
    tasks.push(mysql2Connection.end().catch(function () {}));
  }

  return global.Promise.all(tasks);
}

nubloxConnection.connect()
  .then(function () {
    return mysql2.createConnection(config);
  })
  .then(function (connection) {
    mysql2Connection = connection;

    var attributedQuery = {
      sql        : 'SELECT ? AS label, ? + 1 AS answer',
      values     : ['shared', 41],
      attributes : {
        request_id : 'compat-query',
        priority   : 7
      }
    };

    return global.Promise.all([
      nubloxConnection.query(attributedQuery),
      mysql2Connection.query(attributedQuery)
    ]);
  })
  .then(function (results) {
    var nubloxResult = results[0];
    var mysql2Result = results[1];

    assert.deepStrictEqual(comparableRows(nubloxResult[0]), comparableRows(mysql2Result[0]));
    assert.deepStrictEqual(fieldNames(nubloxResult[1]), fieldNames(mysql2Result[1]));

    return nubloxConnection.beginTransaction();
  })
  .then(function () {
    return nubloxConnection.query('SELECT 1 AS inside_transaction');
  })
  .then(function () {
    return nubloxConnection.rollback();
  })
  .then(function () {
    return mysql2Connection.beginTransaction();
  })
  .then(function () {
    return mysql2Connection.query('SELECT 1 AS inside_transaction');
  })
  .then(function () {
    return mysql2Connection.rollback();
  })
  .then(function () {
    nubloxPool = nublox.createPool(Object.assign({connectionLimit: 2}, config));
    mysql2Pool = mysql2.createPool(Object.assign({connectionLimit: 2}, config));

    return global.Promise.all([
      nubloxPool.query('SELECT ? AS pooled', [42]),
      mysql2Pool.query('SELECT ? AS pooled', [42])
    ]);
  })
  .then(function (results) {
    assert.deepStrictEqual(comparableRows(results[0][0]), comparableRows(results[1][0]));
    assert.strictEqual(nubloxPool.stats().limit, 2);

    return global.Promise.all([
      captureError(nubloxConnection.query('SELECT * FROM __nublox_mysql2_compat_missing__')),
      captureError(mysql2Connection.query('SELECT * FROM __nublox_mysql2_compat_missing__'))
    ]);
  })
  .then(function (errors) {
    assert.strictEqual(errors[0].code, errors[1].code);
    assert.strictEqual(errors[0].errno, errors[1].errno);
    assert.strictEqual(errors[0].sqlState, errors[1].sqlState);

    return cleanup();
  })
  .catch(function (error) {
    return cleanup().then(function () {
      process.nextTick(function () {
        throw error;
      });
    });
  });
