'use strict';

var assert = require('assert');
var mysql = require('../../promise');

var config = {
  host              : process.env.MYSQL_HOST || '127.0.0.1',
  port              : Number(process.env.MYSQL_PORT || 3306),
  user              : process.env.MYSQL_USER || 'nublox',
  password          : process.env.MYSQL_PASSWORD || 'nublox_ci_password',
  database          : process.env.MYSQL_DATABASE || 'nublox_ci',
  supportBigNumbers : true,
  bigNumberStrings  : true
};
var connection = mysql.createConnection(config);

connection.connect()
  .then(function () {
    return connection.execute(
      'SELECT CAST(? AS SIGNED) AS int8_value, CAST(? AS UNSIGNED) AS uint16_value, ' +
      'CAST(? AS SIGNED) AS int32_value, CAST(? AS UNSIGNED) AS uint32_value, ' +
      'CAST(? AS SIGNED) AS int64_value, CAST(? AS UNSIGNED) AS uint64_value, ' +
      '? + 0e0 AS float_value, ? + 0e0 AS double_value, ' +
      'CAST(? AS DECIMAL(30,9)) AS decimal_value, CONCAT(?, \'\') AS text_value, HEX(?) AS binary_hex, ' +
      'HEX(?) AS bit_hex, CAST(? AS YEAR) AS year_value',
      [
        mysql.param.int8(-128),
        mysql.param.uint16(65535),
        mysql.param.int32(-2147483648),
        mysql.param.uint32(4294967295),
        mysql.param.int64('-9223372036854775808'),
        mysql.param.uint64('18446744073709551615'),
        mysql.param.float(1.25),
        mysql.param.double(123456.125),
        mysql.param.decimal('12345678901234567890.123456789'),
        mysql.param.text('NuBloxSQL'),
        mysql.param.binary(Buffer.from([0, 127, 255])),
        mysql.param.bit('100000000'),
        mysql.param.year(2026)
      ]
    );
  })
  .then(function (result) {
    var row = result[0][0];

    assert.strictEqual(String(row.int8_value), '-128');
    assert.strictEqual(String(row.uint16_value), '65535');
    assert.strictEqual(String(row.int32_value), '-2147483648');
    assert.strictEqual(String(row.uint32_value), '4294967295');
    assert.strictEqual(String(row.int64_value), '-9223372036854775808');
    assert.strictEqual(String(row.uint64_value), '18446744073709551615');
    assert.strictEqual(row.float_value, 1.25);
    assert.strictEqual(row.double_value, 123456.125);
    assert.strictEqual(row.decimal_value, '12345678901234567890.123456789');
    assert.strictEqual(row.text_value, 'NuBloxSQL');
    assert.strictEqual(row.binary_hex, '007FFF');
    assert.strictEqual(row.bit_hex, '0100');
    assert.strictEqual(String(row.year_value), '2026');

    return connection.end();
  })
  .catch(function (error) {
    connection.end().catch(function () {}).then(function () {
      process.nextTick(function () {
        throw error;
      });
    });
  });
