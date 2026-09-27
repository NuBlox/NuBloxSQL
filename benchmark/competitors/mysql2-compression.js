'use strict';

var path = require('path');

var mysql2 = require('mysql2');
var nublox = require(path.resolve(__dirname, '../..'));

var baseConfig = {
  host     : process.env.MYSQL_HOST || '127.0.0.1',
  port     : Number(process.env.MYSQL_PORT || 3306),
  user     : process.env.MYSQL_USER || 'root',
  password : process.env.MYSQL_PASSWORD || '',
  database : process.env.MYSQL_DATABASE || undefined
};
var rows = positiveInteger(process.env.BENCHMARK_ROWS, 1000);
var warmupRows = positiveInteger(process.env.BENCHMARK_WARMUP_ROWS, Math.min(rows, 128));
var rounds = positiveInteger(process.env.BENCHMARK_ROUNDS, 5);
var payloadBytes = positiveInteger(process.env.BENCHMARK_PAYLOAD_BYTES, 4096);
var zstdLevel = positiveInteger(process.env.BENCHMARK_ZSTD_LEVEL, 7);
var profiles = [
  { name: 'uncompressed', nublox: {}, mysql2: {} },
  { name: 'zlib', nublox: { compressionAlgorithms: ['zlib'] }, mysql2: { compress: true } },
  { name: 'zstd', nublox: { compressionAlgorithms: ['zstd'], zstdCompressionLevel: zstdLevel } }
];

function positiveInteger(value, fallback) {
  var parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
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

function durationMs(started) {
  return Number(process.hrtime.bigint() - started) / 1000000;
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

function end(connection) {
  return new global.Promise(function (resolve) {
    connection.end(function () {
      resolve();
    });
  });
}

function query(connection, sql) {
  return new global.Promise(function (resolve, reject) {
    connection.query(sql, function (error, result) {
      if (error) {
        reject(error);
        return;
      }

      resolve(result);
    });
  });
}

function streamSql(rowCount) {
  return 'WITH RECURSIVE seq AS (' +
    'SELECT 1 AS n UNION ALL SELECT n + 1 FROM seq WHERE n < ' + rowCount +
  ") SELECT n AS id, REPEAT('x', " + payloadBytes + ') AS payload FROM seq ORDER BY n';
}

function consume(connection, rowCount) {
  return new global.Promise(function (resolve, reject) {
    var stream;
    var seen = 0;
    var bytes = 0;
    var started = process.hrtime.bigint();

    try {
      stream = connection.query(streamSql(rowCount)).stream();
    } catch (error) {
      reject(error);
      return;
    }

    stream.on('data', function (row) {
      seen++;
      bytes += Buffer.byteLength(row.payload || '', 'utf8');
    });
    stream.on('error', reject);
    stream.on('end', function () {
      if (seen !== rowCount) {
        reject(new Error('Compression benchmark expected ' + rowCount + ' rows but received ' + seen));
        return;
      }

      resolve({
        elapsedMs : durationMs(started),
        rows      : seen,
        bytes     : bytes
      });
    });
  });
}

function configure(connection) {
  return query(connection, 'SET SESSION cte_max_recursion_depth = ' + (Math.max(rows, warmupRows) + 16));
}

function benchmarkRound(connection) {
  return consume(connection, warmupRows)
    .then(function () {
      if (global.gc) {
        global.gc();
      }

      var before = memorySnapshot();

      return consume(connection, rows).then(function (result) {
        if (global.gc) {
          global.gc();
        }

        var settled = memorySnapshot();
        var seconds = result.elapsedMs / 1000;

        return {
          rows             : result.rows,
          elapsedMs        : result.elapsedMs,
          rowsPerSecond    : result.rows / seconds,
          payloadMiBSecond : (result.bytes / 1048576) / seconds,
          memoryDeltaBytes : memoryDelta(settled, before)
        };
      });
    });
}

function benchmarkClient(clientName, profileName, connection) {
  var results = [];
  var round = 1;

  function nextRound() {
    if (round > rounds) {
      return global.Promise.resolve(results);
    }

    return benchmarkRound(connection).then(function (result) {
      result.client = clientName;
      result.profile = profileName;
      result.round = round;
      results.push(result);
      round++;
      return nextRound();
    });
  }

  return connect(connection)
    .then(function () { return configure(connection); })
    .then(nextRound)
    .then(function () { return end(connection); })
    .then(function () { return results; });
}

function runProfile(profile) {
  var nubloxConnection = nublox.createConnection(Object.assign({}, baseConfig, profile.nublox));
  var tasks = [benchmarkClient('@nublox/mysql', profile.name, nubloxConnection)];

  if (profile.mysql2) {
    var mysql2Connection = mysql2.createConnection(Object.assign({}, baseConfig, profile.mysql2));
    tasks.push(benchmarkClient('mysql2', profile.name, mysql2Connection));
  }

  return global.Promise.all(tasks).then(function (results) {
    return [].concat.apply([], results);
  });
}

function runProfiles() {
  var allResults = [];
  var index = 0;

  function nextProfile() {
    if (index >= profiles.length) {
      return global.Promise.resolve(allResults);
    }

    var profile = profiles[index++];

    return runProfile(profile).then(function (results) {
      allResults = allResults.concat(results);
      return nextProfile();
    });
  }

  return nextProfile();
}

runProfiles()
  .then(function (results) {
    process.stdout.write(JSON.stringify({
      benchmark          : 'compression-streaming-select',
      node               : process.version,
      platform           : process.platform,
      arch               : process.arch,
      rows               : rows,
      warmupRows         : warmupRows,
      rounds             : rounds,
      payloadBytesPerRow : payloadBytes,
      zstdLevel          : zstdLevel,
      gcExposed          : typeof global.gc === 'function',
      comparability      : {
        uncompressed : ['@nublox/mysql', 'mysql2'],
        zlib         : ['@nublox/mysql', 'mysql2'],
        zstd         : ['@nublox/mysql']
      },
      results: results
    }, null, 2) + '\n');
  })
  .catch(function (error) {
    process.nextTick(function () {
      throw error;
    });
  });
