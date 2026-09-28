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
var nubloxConnection;
var mysql2Pool;
var nubloxPool;

function comparable(value) {
  return JSON.parse(JSON.stringify(value, function (_key, item) {
    if (Buffer.isBuffer(item)) {
      return {type: 'Buffer', data: Array.prototype.slice.call(item)};
    }
    return item;
  }));
}

function cleanup() {
  var tasks = [];

  if (nubloxPool) tasks.push(nubloxPool.end().catch(function () {}));
  if (mysql2Pool) tasks.push(mysql2Pool.end().catch(function () {}));
  if (nubloxConnection) tasks.push(nubloxConnection.end().catch(function () {}));
  if (mysql2Connection) tasks.push(mysql2Connection.end().catch(function () {}));

  return global.Promise.all(tasks);
}

function run() {
  nubloxConnection = nublox.createConnection(config);

  return nubloxConnection.connect()
    .then(function () {
      return mysql2.createConnection(config);
    })
    .then(function (connection) {
      mysql2Connection = connection;

      var attributedExecute = {
        sql        : 'SELECT ? AS text_value, ? AS number_value, ? AS bool_value, ? AS null_value',
        values     : ['NuBloxSQL', 41.5, true, null],
        attributes : {
          trace_id : 'compat-execute',
          priority : 3
        }
      };

      return global.Promise.all([
        nubloxConnection.execute(attributedExecute),
        mysql2Connection.execute(attributedExecute)
      ]);
    })
    .then(function (results) {
      assert.deepStrictEqual(comparable(results[0][0]), comparable(results[1][0]));
      assert.deepStrictEqual(
        results[0][1].map(function (field) { return field.name; }),
        results[1][1].map(function (field) { return field.name; })
      );

      return global.Promise.all([
        nubloxConnection.query('CREATE TEMPORARY TABLE nublox_execute_test (id INT PRIMARY KEY, label VARCHAR(64), active BOOLEAN)'),
        mysql2Connection.query('CREATE TEMPORARY TABLE nublox_execute_test (id INT PRIMARY KEY, label VARCHAR(64), active BOOLEAN)')
      ]);
    })
    .then(function () {
      return global.Promise.all([
        nubloxConnection.execute('INSERT INTO nublox_execute_test (id, label, active) VALUES (?, ?, ?)', [7, 'prepared', true]),
        mysql2Connection.execute('INSERT INTO nublox_execute_test (id, label, active) VALUES (?, ?, ?)', [7, 'prepared', true])
      ]);
    })
    .then(function (results) {
      assert.strictEqual(results[0][0].affectedRows, results[1][0].affectedRows);

      return global.Promise.all([
        nubloxConnection.execute('SELECT id, label, active FROM nublox_execute_test WHERE id = ?', [7]),
        mysql2Connection.execute('SELECT id, label, active FROM nublox_execute_test WHERE id = ?', [7])
      ]);
    })
    .then(function (results) {
      assert.deepStrictEqual(comparable(results[0][0]), comparable(results[1][0]));

      nubloxPool = nublox.createPool(Object.assign({connectionLimit: 2}, config));
      mysql2Pool = mysql2.createPool(Object.assign({connectionLimit: 2}, config));

      return global.Promise.all([
        nubloxPool.execute('SELECT ? AS pooled', [42]),
        mysql2Pool.execute('SELECT ? AS pooled', [42])
      ]);
    })
    .then(function (results) {
      assert.deepStrictEqual(comparable(results[0][0]), comparable(results[1][0]));
      return nubloxPool.getConnection();
    })
    .then(function (connection) {
      assert.strictEqual(typeof connection.execute, 'function');
      return connection.execute('SELECT ? AS acquired', ['yes']).then(function (result) {
        connection.release();
        assert.strictEqual(result[0][0].acquired, 'yes');
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
