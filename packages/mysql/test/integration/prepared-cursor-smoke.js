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
var cursor;
var iteratorCursor;

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
  .then(function verifyManualClose() {
    assert.strictEqual(cursor.closed, true);
    return connection.openCursor(
      'SELECT ? AS value UNION ALL SELECT ? AS value UNION ALL SELECT ? AS value ORDER BY value',
      [10, 20, 30],
      {fetchSize: 2}
    );
  })
  .then(function verifyIteratorReturn(openedCursor) {
    var iterator;

    iteratorCursor = openedCursor;
    iterator = iteratorCursor[global.Symbol.asyncIterator]();

    return iterator.next().then(function verifyFirstIteratedRow(result) {
      assert.strictEqual(result.done, false);
      assert.strictEqual(result.value.value, 10);
      assert.strictEqual(iteratorCursor.closed, false);
      return iterator.return();
    });
  })
  .then(function verifyIteratorClosed(result) {
    assert.deepStrictEqual(result, {value: undefined, done: true});
    assert.strictEqual(iteratorCursor.closed, true);
    return connection.end();
  })
  .catch(function (error) {
    if (cursor && !cursor.closed) {
      cursor.close();
    }

    if (iteratorCursor && !iteratorCursor.closed) {
      iteratorCursor.close();
    }

    connection.end().catch(function () {}).then(function () {
      process.nextTick(function () {
        throw error;
      });
    });
  });
