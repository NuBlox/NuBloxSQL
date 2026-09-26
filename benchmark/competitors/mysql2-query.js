'use strict';

var path = require('path');

var mysql2 = require('mysql2/promise');
var nublox = require(path.resolve(__dirname, '../../promise'));

var config = {
  host     : process.env.MYSQL_HOST || '127.0.0.1',
  port     : Number(process.env.MYSQL_PORT || 3306),
  user     : process.env.MYSQL_USER || 'root',
  password : process.env.MYSQL_PASSWORD || '',
  database : process.env.MYSQL_DATABASE || undefined
};
var iterations = positiveInteger(process.env.BENCHMARK_ITERATIONS, 1000);
var warmupIterations = positiveInteger(process.env.BENCHMARK_WARMUP, 100);
var mysql2Connection;
var nubloxConnection = nublox.createConnection(config);

function positiveInteger(value, fallback) {
  var parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
}

function durationMs(started) {
  return Number(process.hrtime.bigint() - started) / 1000000;
}

function percentile(values, fraction) {
  var sorted = values.slice().sort(function (left, right) {
    return left - right;
  });
  var index = Math.min(sorted.length - 1, Math.floor(sorted.length * fraction));

  return sorted[index];
}

function executeQueries(connection, count, collectSamples) {
  var samples = [];
  var completed = 0;
  var totalStarted = process.hrtime.bigint();

  function next() {
    var started;

    if (completed >= count) {
      return global.Promise.resolve({
        elapsedMs : durationMs(totalStarted),
        samples   : samples
      });
    }

    started = process.hrtime.bigint();

    return connection.query('SELECT 1 AS value').then(function () {
      if (collectSamples) {
        samples.push(durationMs(started));
      }

      completed++;
      return next();
    });
  }

  return next();
}

function benchmark(name, connection) {
  return executeQueries(connection, warmupIterations, false)
    .then(function () {
      return executeQueries(connection, iterations, true);
    })
    .then(function (result) {
      var totalSampleMs = result.samples.reduce(function (sum, value) {
        return sum + value;
      }, 0);

      return {
        client           : name,
        iterations       : iterations,
        elapsedMs        : result.elapsedMs,
        queriesPerSecond : iterations / (result.elapsedMs / 1000),
        meanLatencyMs    : totalSampleMs / result.samples.length,
        p50LatencyMs     : percentile(result.samples, 0.50),
        p95LatencyMs     : percentile(result.samples, 0.95),
        p99LatencyMs     : percentile(result.samples, 0.99)
      };
    });
}

function cleanup() {
  var tasks = [];

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
    return benchmark('@nublox/mysql', nubloxConnection);
  })
  .then(function (nubloxResult) {
    return benchmark('mysql2', mysql2Connection).then(function (mysql2Result) {
      return [nubloxResult, mysql2Result];
    });
  })
  .then(function (results) {
    process.stdout.write(JSON.stringify({
      benchmark : 'sequential-select-one',
      node      : process.version,
      warmup    : warmupIterations,
      results   : results
    }, null, 2) + '\n');

    return cleanup();
  })
  .catch(function (error) {
    return cleanup().then(function () {
      process.nextTick(function () {
        throw error;
      });
    });
  });
