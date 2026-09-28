'use strict';

var Binlog = require('../../binlog');
var Mysql  = require('../..');

var config = {
  host                    : process.env.MYSQL_HOST || '127.0.0.1',
  port                    : Number(process.env.MYSQL_PORT || 3306),
  user                    : process.env.MYSQL_USER || 'nublox',
  password                : process.env.MYSQL_PASSWORD || 'nublox_ci_password',
  database                : process.env.MYSQL_DATABASE || 'nublox_ci',
  allowPublicKeyRetrieval : true
};
var rootConfig = {
  host                    : config.host,
  port                    : config.port,
  user                    : 'root',
  password                : process.env.MYSQL_ROOT_PASSWORD || 'nublox_root_password',
  database                : config.database,
  allowPublicKeyRetrieval : true
};
var root = Mysql.createConnection(rootConfig).promise();
var writer = Mysql.createConnection(config).promise();
var replication = null;
var filename;
var position;
var executedBefore;
var checksumBytes;

run()
  .then(function() {
    return cleanup();
  }, function(error) {
    return cleanup().then(function() {
      throw error;
    });
  })
  .catch(function(error) {
    console.error(error && error.stack || error);
    process.exitCode = 1;
  });

function run() {
  return root.connect()
    .then(function() {
      return writer.connect();
    })
    .then(function() {
      return root.query("GRANT REPLICATION SLAVE, REPLICATION CLIENT ON *.* TO '" + config.user + "'@'%'");
    })
    .then(function() {
      return root.query('SELECT @@global.gtid_mode AS gtidMode, @@global.gtid_executed AS executed');
    })
    .then(function(gtidResult) {
      var row = gtidResult[0][0];
      if (String(row.gtidMode).toUpperCase() !== 'ON') {
        throw new Error('GTID live smoke requires gtid_mode=ON');
      }
      executedBefore = String(row.executed || '');
      return root.query('SHOW BINARY LOG STATUS');
    })
    .then(function(statusResult) {
      var statusRows = statusResult[0];
      if (!statusRows || statusRows.length === 0) {
        throw new Error('SHOW BINARY LOG STATUS returned no active binary log');
      }

      filename = statusRows[0].File;
      position = global.BigInt(statusRows[0].Position);
      return root.query('SELECT @@global.binlog_checksum AS checksum');
    })
    .then(function(checksumResult) {
      var checksumName = String(checksumResult[0][0].checksum || '').toUpperCase();
      checksumBytes = checksumName === 'CRC32' ? 4 : 0;
      return writer.query('DROP TABLE IF EXISTS nublox_binlog_gtid_smoke');
    })
    .then(function() {
      return writer.query(
        'CREATE TABLE nublox_binlog_gtid_smoke (' +
          'id INT PRIMARY KEY, payload VARCHAR(64) NOT NULL' +
        ') ENGINE=InnoDB'
      );
    })
    .then(function() {
      return writer.query(
        'INSERT INTO nublox_binlog_gtid_smoke (id, payload) VALUES (?, ?)',
        [1, 'nublox-gtid-resume-smoke']
      );
    })
    .then(function() {
      replication = Binlog.createReplicationConnection(config);
      return queryReplication('SET @' + 'master_binlog_checksum=@@global.binlog_checksum');
    })
    .then(function() {
      var sequence = replication.binlogDump({
        filename       : filename,
        position       : position,
        flags          : 1,
        serverId       : 987654322,
        gtidSet        : executedBefore,
        decoderOptions : {checksumBytes: checksumBytes}
      });

      return collect(sequence.stream({highWaterMark: 4}));
    })
    .then(function(events) {
      if (events.length === 0) {
        throw new Error('COM_BINLOG_DUMP_GTID returned no binlog events');
      }

      var gtidEvents = events.filter(function(event) {
        return event.type === Binlog.EventTypes.GTID_LOG_EVENT;
      });

      if (gtidEvents.length === 0) {
        throw new Error('COM_BINLOG_DUMP_GTID returned no GTID_LOG_EVENT after the resume set');
      }

      if (!events.some(function(event) {
        return event.type === Binlog.EventTypes.TABLE_MAP_EVENT ||
          event.type === Binlog.EventTypes.XID_EVENT ||
          event.type === Binlog.EventTypes.QUERY_EVENT;
      })) {
        throw new Error('COM_BINLOG_DUMP_GTID did not return an expected change event');
      }

      console.log(
        'live GTID binlog stream: %d events, %d GTIDs from %s:%s',
        events.length,
        gtidEvents.length,
        filename,
        position.toString()
      );
    });
}

function queryReplication(sql) {
  return new global.Promise(function(resolve, reject) {
    replication.query(sql, function(error) {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

function collect(stream) {
  return new global.Promise(function(resolve, reject) {
    var events = [];
    stream.on('data', function(event) {
      events.push(event);
    });
    stream.once('error', reject);
    stream.once('end', function() {
      resolve(events);
    });
  });
}

function cleanup() {
  if (replication) {
    replication.destroy();
  }

  return ignoreFailure(function() {
    return writer.query('DROP TABLE IF EXISTS nublox_binlog_gtid_smoke');
  })
    .then(function() {
      return ignoreFailure(function() {
        return writer.end();
      });
    })
    .then(function() {
      return ignoreFailure(function() {
        return root.end();
      });
    });
}

function ignoreFailure(work) {
  try {
    return global.Promise.resolve(work()).catch(function() {});
  } catch (error) {
    return global.Promise.resolve();
  }
}
