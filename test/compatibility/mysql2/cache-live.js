'use strict';

var assert = require('assert');
var path = require('path');

var nublox = require(path.resolve(__dirname, '../../../promise'));

var baseConfig = {
  host     : process.env.MYSQL_HOST || '127.0.0.1',
  port     : Number(process.env.MYSQL_PORT || 3306),
  user     : process.env.MYSQL_USER || 'root',
  password : process.env.MYSQL_PASSWORD || '',
  database : process.env.MYSQL_DATABASE || undefined
};
var cached;
var uncached;

function cleanup() {
  var tasks = [];

  if (cached) tasks.push(cached.end().catch(function () {}));
  if (uncached) tasks.push(uncached.end().catch(function () {}));

  return global.Promise.all(tasks);
}

function labels(rows) {
  return rows.map(function (row) {
    return row.label;
  });
}

cached = nublox.createConnection(Object.assign({maxPreparedStatements: 2}, baseConfig));

cached.connect()
  .then(function () {
    return cached.execute('SELECT ? AS value', [1]);
  })
  .then(function () {
    var stats = cached.preparedStatementCacheStats();
    assert.strictEqual(stats.size, 1);
    assert.strictEqual(stats.misses, 1);
    assert.strictEqual(stats.prepares, 1);

    return cached.execute('SELECT ? AS value', [2]);
  })
  .then(function () {
    var stats = cached.preparedStatementCacheStats();
    assert.strictEqual(stats.size, 1);
    assert.strictEqual(stats.hits, 1);
    assert.strictEqual(stats.prepares, 1);

    return cached.execute('SELECT ? + 1 AS value', [2]);
  })
  .then(function () {
    return cached.execute('SELECT ? + 2 AS value', [2]);
  })
  .then(function () {
    var stats = cached.preparedStatementCacheStats();
    assert.strictEqual(stats.size, 2);
    assert.strictEqual(stats.evictions, 1);
    assert.strictEqual(stats.prepares, 3);

    cached.unprepare('SELECT ? + 2 AS value');
    assert.strictEqual(cached.preparedStatementCacheStats().size, 1);

    cached.clearPreparedStatementCache();
    assert.strictEqual(cached.preparedStatementCacheStats().size, 0);

    uncached = nublox.createConnection(Object.assign({maxPreparedStatements: 0}, baseConfig));
    return uncached.connect();
  })
  .then(function () {
    return uncached.execute('SELECT ? AS uncached', [1]);
  })
  .then(function () {
    return uncached.execute('SELECT ? AS uncached', [2]);
  })
  .then(function () {
    var stats = uncached.preparedStatementCacheStats();
    assert.strictEqual(stats.limit, 0);
    assert.strictEqual(stats.size, 0);
    assert.strictEqual(stats.hits, 0);
    assert.strictEqual(stats.misses, 2);
    assert.strictEqual(stats.prepares, 2);

    return uncached.query(
      'CREATE TEMPORARY TABLE nublox_execute_order (' +
      'id INT NOT NULL AUTO_INCREMENT PRIMARY KEY, label VARCHAR(64) NOT NULL)'
    );
  })
  .then(function () {
    var first = uncached.execute('INSERT INTO nublox_execute_order (label) VALUES (?)', ['execute-1']);
    var second = uncached.query("INSERT INTO nublox_execute_order (label) VALUES ('query-2')");
    var third = uncached.execute('INSERT INTO nublox_execute_order (label) VALUES (?)', ['execute-3']);

    return global.Promise.all([first, second, third]);
  })
  .then(function () {
    return uncached.query('SELECT label FROM nublox_execute_order ORDER BY id');
  })
  .then(function (result) {
    assert.deepStrictEqual(labels(result[0]), ['execute-1', 'query-2', 'execute-3']);
    return cleanup();
  })
  .catch(function (error) {
    cleanup().then(function () {
      process.nextTick(function () {
        throw error;
      });
    });
  });
