'use strict';

var assert = require('assert');
var mysql = require('../../promise');

var config = {
  host     : process.env.MYSQL_HOST || '127.0.0.1',
  port     : Number(process.env.MYSQL_PORT || 3306),
  user     : process.env.MYSQL_USER || 'nublox',
  password : process.env.MYSQL_PASSWORD || 'nublox_ci_password',
  database : process.env.MYSQL_DATABASE || 'nublox_ci'
};
var connection = mysql.createConnection(config);
var cursor;

connection.connect()
  .then(function openCursor() {
    return connection.openCursor(
      'SELECT ? AS value UNION ALL SELECT ? AS value UNION ALL SELECT ? AS value ORDER BY value',
      [1, 2, 3],
      {fetchSize: 2}
    );
  })
  .then(function fetchFirst(openedCursor) {
    cursor = openedCursor;
    assert.strictEqual(cursor.done, false);
    assert.strictEqual(cursor.closed, false);
    assert.strictEqual(cursor.fields.length, 1);
    return cursor.fetch();
  })
  .then(function verifyFirst(batch) {
    assert.deepStrictEqual(batch.rows.map(function (row) { return row.value; }), [1, 2]);
    assert.strictEqual(batch.done, false);
    return cursor.fetch();
  })
  .then(function verifySecond(batch) {
    assert.deepStrictEqual(batch.rows.map(function (row) { return row.value; }), [3]);
    assert.strictEqual(batch.done, true);
    assert.strictEqual(cursor.done, true);
    return cursor.fetch();
  })
  .then(function verifyExhausted(batch) {
    assert.deepStrictEqual(batch.rows, []);
    assert.strictEqual(batch.done, true);
    return cursor.close();
  })
  .then(function closeConnection() {
    assert.strictEqual(cursor.closed, true);
    return connection.end();
  })
  .catch(function (error) {
    if (cursor && !cursor.closed) {
      cursor.close();
    }

    connection.end().catch(function () {}).then(function () {
      process.nextTick(function () {
        throw error;
      });
    });
  });
