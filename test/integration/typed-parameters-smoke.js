'use strict';

var assert = require('assert');
var mysql = require('../../promise');

var config = {
  host             : process.env.MYSQL_HOST || '127.0.0.1',
  port             : Number(process.env.MYSQL_PORT || 3306),
  user             : process.env.MYSQL_USER || 'nublox',
  password         : process.env.MYSQL_PASSWORD || 'nublox_ci_password',
  database         : process.env.MYSQL_DATABASE || 'nublox_ci',
  supportBigNumbers: true,
  bigNumberStrings : true
};
var connection = mysql.createConnection(config);

connection.connect()
  .then(function () {
    return connection.execute(
      'SELECT ? AS int8_value, ? AS uint16_value, ? AS int32_value, ? AS uint32_value, ' +
      '? AS int64_value, ? AS uint64_value, ? AS float_value, ? AS double_value, ' +
      '? AS decimal_value, ? AS text_value, HEX(?) AS binary_hex',
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
        mysql.param.binary(Buffer.from([0, 127, 255]))
      ]
    );
  })
  .then(function (result) {
    var row = result[0][0];
    var fields = result[1];

    assert.strictEqual(row.int8_value, -128);
    assert.strictEqual(row.uint16_value, 65535);
    assert.strictEqual(row.int32_value, -2147483648);
    assert.strictEqual(row.uint32_value, 4294967295);
    assert.strictEqual(row.int64_value, '-9223372036854775808');
    assert.strictEqual(row.uint64_value, '18446744073709551615');
    assert.strictEqual(row.float_value, 1.25);
    assert.strictEqual(row.double_value, 123456.125);
    assert.strictEqual(row.decimal_value, '12345678901234567890.123456789');
    assert.strictEqual(row.text_value, 'NuBloxSQL');
    assert.strictEqual(row.binary_hex, '007FFF');

    assert.strictEqual(fields[0].type, mysql.Types.TINY);
    assert.strictEqual(fields[1].type, mysql.Types.SHORT);
    assert.strictEqual(fields[2].type, mysql.Types.LONG);
    assert.strictEqual(fields[3].type, mysql.Types.LONG);
    assert.strictEqual(fields[4].type, mysql.Types.LONGLONG);
    assert.strictEqual(fields[5].type, mysql.Types.LONGLONG);
    assert.strictEqual(fields[6].type, mysql.Types.FLOAT);
    assert.strictEqual(fields[7].type, mysql.Types.DOUBLE);
    assert.strictEqual(fields[8].type, mysql.Types.NEWDECIMAL);
    assert.strictEqual(fields[9].type, mysql.Types.VAR_STRING);

    return connection.end();
  })
  .catch(function (error) {
    connection.end().catch(function () {}).then(function () {
      process.nextTick(function () {
        throw error;
      });
    });
  });
