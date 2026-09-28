'use strict';

var Binlog = require('../../binlog');
var Mysql  = require('../..');

var config = {
  host     : process.env.MYSQL_HOST || '127.0.0.1',
  port     : Number(process.env.MYSQL_PORT || 3306),
  user     : process.env.MYSQL_USER || 'nublox',
  password : process.env.MYSQL_PASSWORD || 'nublox_ci_password',
  database : process.env.MYSQL_DATABASE || 'nublox_ci'
};
var rootConfig = {
  host     : config.host,
  port     : config.port,
  user     : 'root',
  password : process.env.MYSQL_ROOT_PASSWORD || 'nublox_root_password',
  database : config.database
};

main().catch(function(error) {
  console.error(error && error.stack || error);
  process.exitCode = 1;
});

async function main() {
  var root = Mysql.createConnection(rootConfig).promise();
  var writer = Mysql.createConnection(config).promise();
  var replication;

  try {
    await root.connect();
    await writer.connect();

    await root.query("GRANT REPLICATION SLAVE, REPLICATION CLIENT ON *.* TO '" + config.user + "'@'%'");

    var statusResult = await root.query('SHOW BINARY LOG STATUS');
    var statusRows = statusResult[0];
    if (!statusRows || statusRows.length === 0) {
      throw new Error('SHOW BINARY LOG STATUS returned no active binary log');
    }

    var start = statusRows[0];
    var filename = start.File;
    var position = Number(start.Position);

    var checksumResult = await root.query('SELECT @@global.binlog_checksum AS checksum');
    var checksumName = String(checksumResult[0][0].checksum || '').toUpperCase();
    var checksumBytes = checksumName === 'CRC32' ? 4 : 0;

    await writer.query('DROP TABLE IF EXISTS nublox_binlog_stream_smoke');
    await writer.query(
      'CREATE TABLE nublox_binlog_stream_smoke (' +
        'id INT PRIMARY KEY, payload VARCHAR(64) NOT NULL' +
      ') ENGINE=InnoDB'
    );
    await writer.query(
      'INSERT INTO nublox_binlog_stream_smoke (id, payload) VALUES (?, ?)',
      [1, 'nublox-cdc-smoke']
    );

    replication = Binlog.createReplicationConnection(config);
    var sequence = replication.binlogDump({
      filename       : filename,
      position       : position,
      flags          : 1,
      serverId       : 987654321,
      decoderOptions : {checksumBytes: checksumBytes}
    });
    var stream = sequence.stream({highWaterMark: 4});
    var events = [];

    for await (var event of stream) {
      events.push(event);
    }

    if (events.length === 0) {
      throw new Error('COM_BINLOG_DUMP returned no binlog events');
    }

    if (!events.some(function(event) {
      return event.type === Binlog.EventTypes.QUERY_EVENT ||
        event.type === Binlog.EventTypes.TABLE_MAP_EVENT ||
        event.type === Binlog.EventTypes.XID_EVENT;
    })) {
      throw new Error('COM_BINLOG_DUMP did not return an expected change event');
    }

    console.log(
      'live binlog stream: %d events from %s:%d (checksum=%s)',
      events.length,
      filename,
      position,
      checksumName || 'NONE'
    );
  } finally {
    if (replication) {
      replication.destroy();
    }

    try {
      await writer.query('DROP TABLE IF EXISTS nublox_binlog_stream_smoke');
    } catch (error) {
      // Best-effort cleanup after transport/protocol failures.
    }

    try {
      await writer.end();
    } catch (error) {
      // Ignore cleanup failure.
    }

    try {
      await root.end();
    } catch (error) {
      // Ignore cleanup failure.
    }
  }
}
