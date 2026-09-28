'use strict';

var path = require('path');

var mysql2 = require('mysql2');
var nublox = require(path.resolve(__dirname, '../..'));

var config = {
  host     : process.env.MYSQL_HOST || '127.0.0.1',
  port     : Number(process.env.MYSQL_PORT || 3306),
  user     : process.env.MYSQL_USER || 'root',
  password : process.env.MYSQL_PASSWORD || '',
  database : process.env.MYSQL_DATABASE || undefined
};
var rows = positiveInteger(process.env.BENCHMARK_ROWS, 1000);
var warmupRows = positiveInteger(process.env.BENCHMARK_WARMUP_ROWS, Math.min(rows, 128));
var rounds = positiveInteger(process.env.BENCHMARK_ROUNDS, 5);
var payloadBytes = nonNegativeInteger(process.env.BENCHMARK_PAYLOAD_BYTES, 256);
var highWaterMark = nonNegativeInteger(process.env.BENCHMARK_HIGH_WATER_MARK, 16);
var memorySampleEvery = positiveInteger(process.env.BENCHMARK_MEMORY_SAMPLE_EVERY, 64);
var mysql2Connection = mysql2.createConnection(config);
var nubloxConnection = nublox.createConnection(config);

function positiveInteger(value, fallback) {
  var parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
}

function nonNegativeInteger(value, fallback) {
  var parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed < 0) {
    return fallback;
  }

  return parsed;
}

function durationMs(started) {
  return Number(process.hrtime.bigint() - started) / 1000000;
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

function memoryDelta(after, before) {
  return {
    rss          : after.rss - before.rss,
    heapUsed     : after.heapUsed - before.heapUsed,
    external     : after.external - before.external,
    arrayBuffers : after.arrayBuffers - before.arrayBuffers
  };
}

function updatePeak(peak, current) {
  peak.rss = Math.max(peak.rss, current.rss);
  peak.heapUsed = Math.max(peak.heapUsed, current.heapUsed);
  peak.external = Math.max(peak.external, current.external);
  peak.arrayBuffers = Math.max(peak.arrayBuffers, current.arrayBuffers);
}

function connect(connection) {
  return new global.Promise(function (resolve, reject) {
    connection.connect(function (error) {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

function query(connection, sql, values) {
  return new global.Promise(function (resolve, reject) {
    connection.query(sql, values || [], function (error, result) {
      if (error) {
        reject(error);
        return;
      }

      resolve(result);
    });
  });
}

function end(connection) {
  return new global.Promise(function (resolve) {
    connection.end(function () {
      resolve();
    });
  });
}

function streamSql(rowCount) {
  return 'WITH RECURSIVE seq AS (' +
    'SELECT 1 AS n UNION ALL SELECT n + 1 FROM seq WHERE n < ' + rowCount +
  ') SELECT n AS id, RPAD(\'x\', ' + payloadBytes + ', \'x\') AS payload FROM seq ORDER BY n';
}

function consumeStream(connection, rowCount, collectMetrics) {
  return new global.Promise(function (resolve, reject) {
    var before = memorySnapshot();
    var peak = Object.assign({}, before);
    var started = process.hrtime.bigint();
    var firstRowMs = null;
    var seen = 0;
    var payloadReadBytes = 0;
    var stream;

    try {
      stream = connection.query(streamSql(rowCount)).stream({
        highWaterMark: highWaterMark
      });
    } catch (error) {
      reject(error);
      return;
    }

    stream.on('data', function (row) {
      seen++;

      if (firstRowMs === null) {
        firstRowMs = durationMs(started);
      }

      if (Number(row.id) !== seen) {
        stream.destroy(new Error('Streaming benchmark returned rows out of order'));
        return;
      }

      if (Buffer.byteLength(row.payload || '', 'utf8') !== payloadBytes) {
        stream.destroy(new Error('Streaming benchmark returned an unexpected payload size'));
        return;
      }

      payloadReadBytes += payloadBytes;

      if (collectMetrics && seen % memorySampleEvery === 0) {
        updatePeak(peak, memorySnapshot());
      }
    });

    stream.on('error', reject);
    stream.on('end', function () {
      var elapsedMs = durationMs(started);
      var after = memorySnapshot();

      updatePeak(peak, after);

      if (seen !== rowCount) {
        reject(new Error('Streaming benchmark expected ' + rowCount + ' rows but received ' + seen));
        return;
      }

      resolve({
        elapsedMs        : elapsedMs,
        firstRowMs       : firstRowMs,
        rows             : seen,
        payloadReadBytes : payloadReadBytes,
        memoryAfter      : after,
        memoryPeak       : peak,
        memoryBefore     : before
      });
    });
  });
}

function benchmarkRound(name, connection, round) {
  if (global.gc) {
    global.gc();
  }

  return consumeStream(connection, warmupRows, false)
    .then(function () {
      if (global.gc) {
        global.gc();
      }

      return consumeStream(connection, rows, true);
    })
    .then(function (result) {
      if (global.gc) {
        global.gc();
      }

      var settled = memorySnapshot();
      var seconds = result.elapsedMs / 1000;

      return {
        client               : name,
        round                : round,
        rows                 : result.rows,
        payloadBytesPerRow   : payloadBytes,
        highWaterMark        : highWaterMark,
        elapsedMs            : result.elapsedMs,
        firstRowMs           : result.firstRowMs,
        rowsPerSecond        : result.rows / seconds,
        payloadMiBPerSecond  : (result.payloadReadBytes / 1048576) / seconds,
        memoryDeltaBytes     : memoryDelta(settled, result.memoryBefore),
        peakMemoryDeltaBytes : memoryDelta(result.memoryPeak, result.memoryBefore)
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

function configureConnection(connection) {
  var recursionDepth = Math.max(rows, warmupRows) + 16;

  return query(connection, 'SET SESSION cte_max_recursion_depth = ?', [recursionDepth]);
}

function cleanup() {
  return global.Promise.all([
    end(nubloxConnection).catch(function () {}),
    end(mysql2Connection).catch(function () {})
  ]);
}

global.Promise.all([
  connect(nubloxConnection).then(function () { return configureConnection(nubloxConnection); }),
  connect(mysql2Connection).then(function () { return configureConnection(mysql2Connection); })
])
  .then(function () {
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
      benchmark          : 'streaming-select-rows',
      node               : process.version,
      platform           : process.platform,
      arch               : process.arch,
      rows               : rows,
      warmupRows         : warmupRows,
      rounds             : rounds,
      payloadBytesPerRow : payloadBytes,
      highWaterMark      : highWaterMark,
      memorySampleEvery  : memorySampleEvery,
      gcExposed          : typeof global.gc === 'function',
      results            : results
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
