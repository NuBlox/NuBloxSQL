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
var iterations = positiveInteger(process.env.BENCHMARK_ITERATIONS, 5000);
var warmupIterations = positiveInteger(process.env.BENCHMARK_WARMUP, 500);
var rounds = positiveInteger(process.env.BENCHMARK_ROUNDS, 5);
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

function memorySnapshot() {
  var usage = process.memoryUsage();

  return {
    rss          : usage.rss,
    heapUsed     : usage.heapUsed,
    external     : usage.external,
    arrayBuffers : usage.arrayBuffers
  };
}

function executePrepared(connection, count, collectSamples) {
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

    return connection.execute('SELECT ? AS value', [completed]).then(function () {
      if (collectSamples) {
        samples.push(durationMs(started));
      }

      completed++;
      return next();
    });
  }

  return next();
}

function benchmarkRound(name, connection, round) {
  if (global.gc) {
    global.gc();
  }

  var before = memorySnapshot();

  return executePrepared(connection, warmupIterations, false)
    .then(function () {
      return executePrepared(connection, iterations, true);
    })
    .then(function (result) {
      if (global.gc) {
        global.gc();
      }

      var after = memorySnapshot();
      var totalSampleMs = result.samples.reduce(function (sum, value) {
        return sum + value;
      }, 0);

      return {
        client           : name,
        round            : round,
        iterations       : iterations,
        elapsedMs        : result.elapsedMs,
        queriesPerSecond : iterations / (result.elapsedMs / 1000),
        meanLatencyMs    : totalSampleMs / result.samples.length,
        p50LatencyMs     : percentile(result.samples, 0.50),
        p95LatencyMs     : percentile(result.samples, 0.95),
        p99LatencyMs     : percentile(result.samples, 0.99),
        memoryDeltaBytes : {
          rss          : after.rss - before.rss,
          heapUsed     : after.heapUsed - before.heapUsed,
          external     : after.external - before.external,
          arrayBuffers : after.arrayBuffers - before.arrayBuffers
        }
      };
    });
}

function benchmark(name, connection) {
  var results = [];
  var round = 1;

  function nextRound() {
    if (round > rounds) {
      return global.Promise.resolve(results);
    }

    return benchmarkRound(name, connection, round).then(function (result) {
      results.push(result);
      round++;
      return nextRound();
    });
  }

  return nextRound();
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
  .then(function (nubloxResults) {
    return benchmark('mysql2', mysql2Connection).then(function (mysql2Results) {
      return {
        nublox : nubloxResults,
        mysql2 : mysql2Results
      };
    });
  })
  .then(function (results) {
    process.stdout.write(JSON.stringify({
      benchmark  : 'sequential-prepared-select-one',
      node       : process.version,
      platform   : process.platform,
      arch       : process.arch,
      warmup     : warmupIterations,
      iterations : iterations,
      rounds     : rounds,
      gcExposed  : typeof global.gc === 'function',
      results    : results
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
