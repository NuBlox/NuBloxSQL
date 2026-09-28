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
var concurrency = positiveInteger(process.env.BENCHMARK_CONCURRENCY, 32);
var poolSize = positiveInteger(process.env.BENCHMARK_POOL_SIZE, 10);
var mysql2Pool = mysql2.createPool(Object.assign({}, config, {
  connectionLimit: poolSize
}));
var nubloxPool = nublox.createPool(Object.assign({}, config, {
  connectionLimit: poolSize
}));

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

function runConcurrent(pool, count, collectSamples) {
  var samples = [];
  var nextIndex = 0;
  var totalStarted = process.hrtime.bigint();
  var workers = [];
  var workerCount = Math.min(concurrency, count);

  function worker() {
    function next() {
      var index = nextIndex++;
      var started;

      if (index >= count) {
        return global.Promise.resolve();
      }

      started = process.hrtime.bigint();
      return pool.query('SELECT ? AS value', [index])
        .then(function (result) {
          if (!result || !result[0] || result[0][0].value !== index) {
            throw new Error('Pool benchmark query returned an unexpected value');
          }

          if (collectSamples) {
            samples.push(durationMs(started));
          }

          return next();
        });
    }

    return next();
  }

  for (var i = 0; i < workerCount; i++) {
    workers.push(worker());
  }

  return global.Promise.all(workers).then(function () {
    return {
      elapsedMs : durationMs(totalStarted),
      samples   : samples
    };
  });
}

function benchmarkRound(name, pool, round) {
  if (global.gc) {
    global.gc();
  }

  var before = memorySnapshot();

  return runConcurrent(pool, warmupIterations, false)
    .then(function () {
      return runConcurrent(pool, iterations, true);
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
        concurrency      : concurrency,
        poolSize         : poolSize,
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

function benchmark(name, pool) {
  var results = [];
  var round = 1;

  function nextRound() {
    if (round > rounds) {
      return global.Promise.resolve(results);
    }

    return benchmarkRound(name, pool, round).then(function (result) {
      results.push(result);
      round++;
      return nextRound();
    });
  }

  return nextRound();
}

function cleanup() {
  return global.Promise.all([
    nubloxPool.end().catch(function () {}),
    mysql2Pool.end().catch(function () {})
  ]);
}

benchmark('@nublox/mysql', nubloxPool)
  .then(function (nubloxResults) {
    return benchmark('mysql2', mysql2Pool).then(function (mysql2Results) {
      return {
        nublox : nubloxResults,
        mysql2 : mysql2Results
      };
    });
  })
  .then(function (results) {
    process.stdout.write(JSON.stringify({
      benchmark   : 'pool-concurrent-select-one',
      node        : process.version,
      platform    : process.platform,
      arch        : process.arch,
      warmup      : warmupIterations,
      iterations  : iterations,
      rounds      : rounds,
      concurrency : concurrency,
      poolSize    : poolSize,
      gcExposed   : typeof global.gc === 'function',
      results     : results
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
