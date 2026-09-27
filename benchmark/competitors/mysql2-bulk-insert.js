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
var rows = positiveInteger(process.env.BENCHMARK_ROWS, 5000);
var batchSize = positiveInteger(process.env.BENCHMARK_BATCH_SIZE, 100);
var warmupRows = positiveInteger(
  process.env.BENCHMARK_WARMUP_ROWS,
  Math.min(rows, batchSize * 2)
);
var rounds = positiveInteger(process.env.BENCHMARK_ROUNDS, 5);
var payloadBytes = nonNegativeInteger(process.env.BENCHMARK_PAYLOAD_BYTES, 128);
var payload = repeatAscii('x', payloadBytes);
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

function repeatAscii(character, count) {
  if (count === 0) {
    return '';
  }

  return new Array(count + 1).join(character);
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

function setup(connection) {
  return query(
    connection,
    'CREATE TEMPORARY TABLE IF NOT EXISTS nublox_bulk_benchmark (' +
      'id INT NOT NULL PRIMARY KEY, payload VARBINARY(4096) NOT NULL' +
    ') ENGINE=InnoDB'
  );
}

function buildBatch(startId, count) {
  var placeholders = [];
  var values = [];

  for (var index = 0; index < count; index++) {
    placeholders.push('(?, ?)');
    values.push(startId + index, payload);
  }

  return {
    sql    : 'INSERT INTO nublox_bulk_benchmark (id, payload) VALUES ' + placeholders.join(', '),
    values : values
  };
}

function insertRows(connection, rowCount, collectMetrics) {
  var nextId = 1;
  var latencies = [];
  var peak = memorySnapshot();

  function nextBatch() {
    if (nextId > rowCount) {
      return global.Promise.resolve({
        latencies : latencies,
        peak      : peak
      });
    }

    var count = Math.min(batchSize, rowCount - nextId + 1);
    var batch = buildBatch(nextId, count);
    var started = process.hrtime.bigint();

    return query(connection, batch.sql, batch.values).then(function (result) {
      if (!result || result.affectedRows !== count) {
        throw new Error('Bulk benchmark insert affected an unexpected number of rows');
      }

      if (collectMetrics) {
        latencies.push(durationMs(started));
        updatePeak(peak, memorySnapshot());
      }

      nextId += count;
      return nextBatch();
    });
  }

  return nextBatch();
}

function warmup(connection) {
  return query(connection, 'TRUNCATE TABLE nublox_bulk_benchmark')
    .then(function () {
      return query(connection, 'START TRANSACTION');
    })
    .then(function () {
      return insertRows(connection, warmupRows, false);
    })
    .then(function () {
      return query(connection, 'ROLLBACK');
    });
}

function measuredRound(connection) {
  var before;
  var started;
  var insertResult;

  return query(connection, 'TRUNCATE TABLE nublox_bulk_benchmark')
    .then(function () {
      if (global.gc) {
        global.gc();
      }

      before = memorySnapshot();
      started = process.hrtime.bigint();
      return query(connection, 'START TRANSACTION');
    })
    .then(function () {
      return insertRows(connection, rows, true);
    })
    .then(function (result) {
      insertResult = result;
      return query(connection, 'COMMIT');
    })
    .then(function () {
      var elapsedMs = durationMs(started);

      updatePeak(insertResult.peak, memorySnapshot());

      return query(connection, 'SELECT COUNT(*) AS count FROM nublox_bulk_benchmark')
        .then(function (result) {
          var actual = Number(result[0].count);

          if (actual !== rows) {
            throw new Error('Bulk benchmark expected ' + rows + ' rows but found ' + actual);
          }

          if (global.gc) {
            global.gc();
          }

          return {
            elapsedMs : elapsedMs,
            latencies : insertResult.latencies,
            peak      : insertResult.peak,
            before    : before,
            settled   : memorySnapshot()
          };
        });
    });
}

function benchmarkRound(name, connection, round) {
  return warmup(connection)
    .then(function () {
      return measuredRound(connection);
    })
    .then(function (result) {
      var seconds = result.elapsedMs / 1000;
      var batchCount = result.latencies.length;
      var totalBatchLatency = result.latencies.reduce(function (sum, value) {
        return sum + value;
      }, 0);

      return {
        client               : name,
        round                : round,
        rows                 : rows,
        batchSize            : batchSize,
        batches              : batchCount,
        payloadBytesPerRow   : payloadBytes,
        elapsedMs            : result.elapsedMs,
        rowsPerSecond        : rows / seconds,
        batchesPerSecond     : batchCount / seconds,
        meanBatchLatencyMs   : totalBatchLatency / batchCount,
        p50BatchLatencyMs    : percentile(result.latencies, 0.50),
        p95BatchLatencyMs    : percentile(result.latencies, 0.95),
        p99BatchLatencyMs    : percentile(result.latencies, 0.99),
        memoryDeltaBytes     : memoryDelta(result.settled, result.before),
        peakMemoryDeltaBytes : memoryDelta(result.peak, result.before)
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
  return global.Promise.all([
    end(nubloxConnection).catch(function () {}),
    end(mysql2Connection).catch(function () {})
  ]);
}

global.Promise.all([
  connect(nubloxConnection).then(function () { return setup(nubloxConnection); }),
  connect(mysql2Connection).then(function () { return setup(mysql2Connection); })
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
      benchmark         : 'bulk-batched-insert',
      node              : process.version,
      platform          : process.platform,
      arch              : process.arch,
      rows              : rows,
      warmupRows        : warmupRows,
      batchSize         : batchSize,
      rounds            : rounds,
      payloadBytesPerRow: payloadBytes,
      gcExposed         : typeof global.gc === 'function',
      results           : results
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
