'use strict';

var assert = require('assert');
var path = require('path');

var mysql2 = require('mysql2/promise');
var nublox = require(path.resolve(__dirname, '../../../promise'));

var baseConfig = {
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
  return JSON.parse(JSON.stringify(value));
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
  var config = Object.assign({namedPlaceholders: true}, baseConfig);

  nubloxConnection = nublox.createConnection(config);

  return nubloxConnection.connect()
    .then(function () {
      return mysql2.createConnection(config);
    })
    .then(function (connection) {
      mysql2Connection = connection;

      var sql = "SELECT :x + :x AS doubled, ':ignored' AS literal_value, :label AS label";
      var values = {x: 21, label: 'NuBloxSQL'};

      return global.Promise.all([
        nubloxConnection.query(sql, values),
        mysql2Connection.query(sql, values)
      ]);
    })
    .then(function (results) {
      assert.deepStrictEqual(comparable(results[0][0]), comparable(results[1][0]));

      var executeSql = 'SELECT :left_value + :right_value AS total, :left_value AS repeated';
      var executeValues = {left_value: 20, right_value: 22};

      return global.Promise.all([
        nubloxConnection.execute(executeSql, executeValues),
        mysql2Connection.execute(executeSql, executeValues)
      ]);
    })
    .then(function (results) {
      assert.deepStrictEqual(comparable(results[0][0]), comparable(results[1][0]));

      return global.Promise.all([
        nubloxConnection.query('SELECT ? AS positional', [42]),
        mysql2Connection.query('SELECT ? AS positional', [42])
      ]);
    })
    .then(function (results) {
      assert.deepStrictEqual(comparable(results[0][0]), comparable(results[1][0]));

      return global.Promise.all([
        nubloxConnection.query({
          sql               : 'SELECT :value AS query_override',
          values            : {value: 'query'},
          namedPlaceholders : true
        }),
        mysql2Connection.query({
          sql               : 'SELECT :value AS query_override',
          values            : {value: 'query'},
          namedPlaceholders : true
        })
      ]);
    })
    .then(function (results) {
      assert.deepStrictEqual(comparable(results[0][0]), comparable(results[1][0]));

      var poolConfig = Object.assign({connectionLimit: 2, namedPlaceholders: true}, baseConfig);
      nubloxPool = nublox.createPool(poolConfig);
      mysql2Pool = mysql2.createPool(poolConfig);

      return global.Promise.all([
        nubloxPool.execute('SELECT :value AS pooled', {value: 'yes'}),
        mysql2Pool.execute('SELECT :value AS pooled', {value: 'yes'})
      ]);
    })
    .then(function (results) {
      assert.deepStrictEqual(comparable(results[0][0]), comparable(results[1][0]));
      return cleanup();
    });
}

run().catch(function (error) {
  cleanup().then(function () {
    process.nextTick(function () {
      throw error;
    });
  });
});
