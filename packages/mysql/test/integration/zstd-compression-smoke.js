'use strict';

var assert = require('assert');
var mysql = require('../../promise');

var config = {
  host                  : process.env.MYSQL_HOST || '127.0.0.1',
  port                  : Number(process.env.MYSQL_PORT || 3306),
  user                  : process.env.MYSQL_USER || 'nublox',
  password              : process.env.MYSQL_PASSWORD || 'nublox_ci_password',
  database              : process.env.MYSQL_DATABASE || 'nublox_ci',
  compressionAlgorithms : ['zstd'],
  zstdCompressionLevel  : 7
};
var connection = mysql.createConnection(config);
var outbound = 'NuBloxSQL-zstd-'.repeat(32768);

connection.connect()
  .then(function () {
    return connection.query("SHOW SESSION STATUS LIKE 'Compression_algorithm'");
  })
  .then(function (result) {
    assert.strictEqual(result[0].length, 1);
    assert.strictEqual(String(result[0][0].Value).toLowerCase(), 'zstd');

    return connection.query("SHOW SESSION STATUS LIKE 'Compression_level'");
  })
  .then(function (result) {
    assert.strictEqual(result[0].length, 1);
    assert.strictEqual(Number(result[0][0].Value), 7);

    return connection.execute(
      'SELECT LENGTH(?) AS outbound_length, SHA2(?, 256) AS outbound_hash, ' +
      "LENGTH(REPEAT('Z', 1048576)) AS inbound_length, " +
      "SHA2(REPEAT('Z', 1048576), 256) AS inbound_hash",
      [outbound, outbound]
    );
  })
  .then(function (result) {
    var row = result[0][0];

    assert.strictEqual(row.outbound_length, Buffer.byteLength(outbound));
    assert.strictEqual(row.outbound_hash, require('crypto').createHash('sha256').update(outbound).digest('hex'));
    assert.strictEqual(row.inbound_length, 1048576);
    assert.strictEqual(row.inbound_hash, require('crypto').createHash('sha256').update(Buffer.alloc(1048576, 0x5a)).digest('hex'));

    return connection.end();
  })
  .catch(function (error) {
    connection.end().catch(function () {}).then(function () {
      process.nextTick(function () {
        throw error;
      });
    });
  });
