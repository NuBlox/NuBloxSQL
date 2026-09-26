'use strict';

var assert = require('assert');
var mysql = require('../../promise');

var baseConfig = {
  host              : process.env.MYSQL_HOST || '127.0.0.1',
  port              : Number(process.env.MYSQL_PORT || 3306),
  user              : process.env.MYSQL_USER || 'nublox',
  password          : process.env.MYSQL_PASSWORD || 'nublox_ci_password',
  database          : process.env.MYSQL_DATABASE || 'nublox_ci',
  supportBigNumbers : true,
  bigNumberStrings  : true,
  dateStrings       : true
};
var connection = mysql.createConnection(baseConfig);
var selectiveConnection;
var table = 'nublox_binary_result_matrix';

function bufferHex(value) {
  assert.ok(Buffer.isBuffer(value));
  return value.toString('hex');
}

function cleanup() {
  var tasks = [];

  if (connection) {
    tasks.push(connection.end().catch(function () {}));
  }

  if (selectiveConnection) {
    tasks.push(selectiveConnection.end().catch(function () {}));
  }

  return global.Promise.all(tasks);
}

connection.connect()
  .then(function () {
    return connection.query(
      'CREATE TEMPORARY TABLE ' + table + ' (' +
      'tiny_signed TINYINT NOT NULL, ' +
      'tiny_unsigned TINYINT UNSIGNED NOT NULL, ' +
      'small_signed SMALLINT NOT NULL, ' +
      'small_unsigned SMALLINT UNSIGNED NOT NULL, ' +
      'int_signed INT NOT NULL, ' +
      'int_unsigned INT UNSIGNED NOT NULL, ' +
      'big_signed BIGINT NOT NULL, ' +
      'big_unsigned BIGINT UNSIGNED NOT NULL, ' +
      'decimal_value DECIMAL(30,9) NOT NULL, ' +
      'float_value FLOAT NOT NULL, ' +
      'double_value DOUBLE NOT NULL, ' +
      'year_value YEAR NOT NULL, ' +
      'date_value DATE NOT NULL, ' +
      'datetime_value DATETIME(6) NOT NULL, ' +
      'timestamp_value TIMESTAMP(6) NOT NULL, ' +
      'time_value TIME(6) NOT NULL, ' +
      'bit_value BIT(32) NOT NULL, ' +
      'binary_value BINARY(4) NOT NULL, ' +
      'varbinary_value VARBINARY(4) NOT NULL, ' +
      'blob_value BLOB NOT NULL, ' +
      'text_value TEXT NOT NULL, ' +
      'json_value JSON NOT NULL, ' +
      "enum_value ENUM('alpha','beta') NOT NULL, " +
      "set_value SET('one','two','three') NOT NULL, " +
      'geometry_value POINT NOT NULL, ' +
      'nullable_value INT NULL)'
    );
  })
  .then(function () {
    return connection.query(
      'INSERT INTO ' + table + ' VALUES (' +
      '-128, 255, -32768, 65535, -2147483648, 4294967295, ' +
      '-9223372036854775808, 18446744073709551615, ' +
      "'12345678901234567890.123456789', 1.25, 123456.125, 2026, " +
      "'2026-09-27', '2026-09-27 00:17:38.123456', '2026-09-27 00:17:38.654321', " +
      "'-120:19:27.000001', b'00000001111111101111111100000000', " +
      "X'0001FEFF', X'0001FEFF', X'0001FEFF', 'NuBloxSQL', " +
      "JSON_OBJECT('name', 'NuBloxSQL', 'count', 7), 'beta', 'one,three', " +
      "ST_GeomFromText('POINT(1.25 -3.5)'), NULL)"
    );
  })
  .then(function () {
    return connection.execute('SELECT * FROM ' + table);
  })
  .then(function (result) {
    var row = result[0][0];

    assert.strictEqual(row.tiny_signed, -128);
    assert.strictEqual(row.tiny_unsigned, 255);
    assert.strictEqual(row.small_signed, -32768);
    assert.strictEqual(row.small_unsigned, 65535);
    assert.strictEqual(row.int_signed, -2147483648);
    assert.strictEqual(row.int_unsigned, 4294967295);
    assert.strictEqual(row.big_signed, '-9223372036854775808');
    assert.strictEqual(row.big_unsigned, '18446744073709551615');
    assert.strictEqual(row.decimal_value, '12345678901234567890.123456789');
    assert.strictEqual(row.float_value, 1.25);
    assert.strictEqual(row.double_value, 123456.125);
    assert.strictEqual(row.year_value, 2026);
    assert.strictEqual(row.date_value, '2026-09-27');
    assert.strictEqual(row.datetime_value, '2026-09-27 00:17:38.123456');
    assert.strictEqual(row.timestamp_value, '2026-09-27 00:17:38.654321');
    assert.strictEqual(row.time_value, '-120:19:27.000001');
    assert.strictEqual(bufferHex(row.bit_value), '01feff00');
    assert.strictEqual(bufferHex(row.binary_value), '0001feff');
    assert.strictEqual(bufferHex(row.varbinary_value), '0001feff');
    assert.strictEqual(bufferHex(row.blob_value), '0001feff');
    assert.strictEqual(row.text_value, 'NuBloxSQL');
    assert.deepStrictEqual(row.json_value, {count: 7, name: 'NuBloxSQL'});
    assert.strictEqual(row.enum_value, 'beta');
    assert.strictEqual(row.set_value, 'one,three');
    assert.deepStrictEqual(row.geometry_value, {x: 1.25, y: -3.5});
    assert.strictEqual(row.nullable_value, null);

    return connection.query('SELECT geometry_value FROM ' + table);
  })
  .then(function (textResult) {
    var textGeometry = textResult[0][0].geometry_value;

    return connection.execute('SELECT geometry_value FROM ' + table).then(function (binaryResult) {
      assert.deepStrictEqual(binaryResult[0][0].geometry_value, textGeometry);
    });
  })
  .then(function () {
    var selectiveConfig = Object.assign({}, baseConfig, {
      dateStrings : ['DATE']
    });

    selectiveConnection = mysql.createConnection(selectiveConfig);
    return selectiveConnection.connect();
  })
  .then(function () {
    return selectiveConnection.query(
      "SELECT CAST('2026-09-27' AS DATE) AS date_value, " +
      "CAST('2026-09-27 01:02:03' AS DATETIME) AS datetime_value"
    );
  })
  .then(function (result) {
    assert.strictEqual(result[0][0].date_value, '2026-09-27');
    assert.ok(result[0][0].datetime_value instanceof Date);
    return cleanup();
  })
  .catch(function (error) {
    return cleanup().then(function () {
      process.nextTick(function () {
        throw error;
      });
    });
  });
