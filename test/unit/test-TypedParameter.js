'use strict';

var assert = require('assert');
var common = require('../common');
var path = require('path');
var test = require('utest');

var BinaryCodec = require(path.resolve(common.lib, 'protocol/BinaryCodec'));
var ComStmtExecutePacket = require(path.resolve(common.lib, 'protocol/packets/ComStmtExecutePacket'));
var Mysql = require(path.resolve(common.lib, '../index'));

function descriptor(parameter) {
  return BinaryCodec.describeParameter(parameter);
}

function encodedHex(parameter) {
  var buffers = [];
  var writer = {
    writeBuffer: function writeBuffer(value) {
      buffers.push(Buffer.from(value));
    }
  };

  BinaryCodec.writeParameterValue(writer, parameter, descriptor(parameter));
  return Buffer.concat(buffers).toString('hex');
}

function encodedLengthCodedBufferHex(parameter) {
  var encoded;
  var writer = {
    writeLengthCodedBuffer: function writeLengthCodedBuffer(value) {
      encoded = Buffer.from(value).toString('hex');
    }
  };

  BinaryCodec.writeParameterValue(writer, parameter, descriptor(parameter));
  return encoded;
}

function encodedNumbers(parameter) {
  var numbers = [];
  var writer = {
    writeUnsignedNumber: function writeUnsignedNumber(bytes, value) {
      numbers.push([bytes, value]);
    }
  };

  BinaryCodec.writeParameterValue(writer, parameter, descriptor(parameter));
  return numbers;
}

test('TypedParameter', {
  'exports explicit prepared parameter constructors': function() {
    assert.equal(typeof Mysql.param, 'object');
    assert.equal(typeof Mysql.param.int8, 'function');
    assert.equal(typeof Mysql.param.uint64, 'function');
    assert.equal(typeof Mysql.param.binary, 'function');
    assert.equal(typeof Mysql.param.bit, 'function');
    assert.equal(typeof Mysql.param.year, 'function');
    assert.equal(typeof Mysql.param.datetime, 'function');
    assert.equal(typeof Mysql.param.time, 'function');
    assert.equal(typeof Mysql.param.json, 'function');
  },

  'preserves integer width and signedness': function() {
    assert.deepStrictEqual(descriptor(Mysql.param.int8(-1)), {type: Mysql.Types.TINY, unsigned: false});
    assert.deepStrictEqual(descriptor(Mysql.param.uint8(255)), {type: Mysql.Types.TINY, unsigned: true});
    assert.deepStrictEqual(descriptor(Mysql.param.int16(-32768)), {type: Mysql.Types.SHORT, unsigned: false});
    assert.deepStrictEqual(descriptor(Mysql.param.uint16(65535)), {type: Mysql.Types.SHORT, unsigned: true});
    assert.deepStrictEqual(descriptor(Mysql.param.int32(-2147483648)), {type: Mysql.Types.LONG, unsigned: false});
    assert.deepStrictEqual(descriptor(Mysql.param.uint32(4294967295)), {type: Mysql.Types.LONG, unsigned: true});
    assert.deepStrictEqual(descriptor(Mysql.param.int64('-9223372036854775808')), {type: Mysql.Types.LONGLONG, unsigned: false});
    assert.deepStrictEqual(descriptor(Mysql.param.uint64('18446744073709551615')), {type: Mysql.Types.LONGLONG, unsigned: true});
  },

  'encodes exact integer widths at the wire boundary': function() {
    assert.strictEqual(encodedHex(Mysql.param.int8(-1)), 'ff');
    assert.strictEqual(encodedHex(Mysql.param.uint8(255)), 'ff');
    assert.strictEqual(encodedHex(Mysql.param.int16(-32768)), '0080');
    assert.strictEqual(encodedHex(Mysql.param.uint16(65535)), 'ffff');
    assert.strictEqual(encodedHex(Mysql.param.int32(-2147483648)), '00000080');
    assert.strictEqual(encodedHex(Mysql.param.uint32(4294967295)), 'ffffffff');
    assert.strictEqual(encodedHex(Mysql.param.int64('-9223372036854775808')), '0000000000000080');
    assert.strictEqual(encodedHex(Mysql.param.uint64('18446744073709551615')), 'ffffffffffffffff');
  },

  'writes type and unsigned flags into COM_STMT_EXECUTE metadata': function() {
    var numbers = [];
    var writer = {
      writeUnsignedNumber: function writeUnsignedNumber(bytes, value) {
        numbers.push([bytes, value]);
      },
      writeBuffer: function writeBuffer() {}
    };
    var packet = new ComStmtExecutePacket(7, [
      Mysql.param.int8(-1),
      Mysql.param.uint16(65535),
      Mysql.param.int32(-2147483648),
      Mysql.param.uint64('18446744073709551615')
    ]);

    packet.write(writer);

    assert.deepStrictEqual(numbers.slice(5), [
      [1, Mysql.Types.TINY], [1, 0x00],
      [1, Mysql.Types.SHORT], [1, 0x80],
      [1, Mysql.Types.LONG], [1, 0x00],
      [1, Mysql.Types.LONGLONG], [1, 0x80]
    ]);
  },

  'encodes DATE and fractional DATETIME values in binary protocol form': function() {
    assert.deepStrictEqual(encodedNumbers(Mysql.param.date('2026-09-27')), [
      [1, 4], [2, 2026], [1, 9], [1, 27]
    ]);

    assert.deepStrictEqual(encodedNumbers(Mysql.param.datetime('2026-09-27 00:17:38.123456')), [
      [1, 11], [2, 2026], [1, 9], [1, 27],
      [1, 0], [1, 17], [1, 38], [4, 123456]
    ]);
  },

  'encodes negative multi-day TIME with microseconds': function() {
    assert.deepStrictEqual(encodedNumbers(Mysql.param.time('-120:19:27.000001')), [
      [1, 12], [1, 1], [4, 5], [1, 0], [1, 19], [1, 27], [4, 1]
    ]);
  },

  'uses dedicated temporal and JSON protocol types': function() {
    assert.deepStrictEqual(descriptor(Mysql.param.date('2026-09-27')), {type: Mysql.Types.DATE, unsigned: false});
    assert.deepStrictEqual(descriptor(Mysql.param.datetime('2026-09-27 00:17:38')), {type: Mysql.Types.DATETIME, unsigned: false});
    assert.deepStrictEqual(descriptor(Mysql.param.timestamp('2026-09-27 00:17:38')), {type: Mysql.Types.TIMESTAMP, unsigned: false});
    assert.deepStrictEqual(descriptor(Mysql.param.time('120:19:27')), {type: Mysql.Types.TIME, unsigned: false});

    var json = Mysql.param.json({name: 'NuBloxSQL', count: 2});
    assert.deepStrictEqual(descriptor(json), {type: Mysql.Types.JSON, unsigned: false});
    assert.strictEqual(json.value, '{"name":"NuBloxSQL","count":2}');
  },

  'encodes BIT values as length-coded big-endian bytes': function() {
    assert.deepStrictEqual(descriptor(Mysql.param.bit(1)), {type: Mysql.Types.BIT, unsigned: true});
    assert.strictEqual(encodedLengthCodedBufferHex(Mysql.param.bit(1)), '01');
    assert.strictEqual(encodedLengthCodedBufferHex(Mysql.param.bit('100000000')), '0100');
    assert.strictEqual(encodedLengthCodedBufferHex(Mysql.param.bit('1111111111111111111111111111111111111111111111111111111111111111')), 'ffffffffffffffff');
  },

  'encodes YEAR using the binary protocol two-byte integer form': function() {
    assert.deepStrictEqual(descriptor(Mysql.param.year(2026)), {type: Mysql.Types.YEAR, unsigned: true});
    assert.strictEqual(encodedHex(Mysql.param.year(2026)), 'ea07');
    assert.strictEqual(encodedHex(Mysql.param.year(0)), '0000');
  },

  'rejects invalid BIT and YEAR values': function() {
    assert.throws(function() {
      Mysql.param.bit(-1);
    }, function(error) {
      return error.code === 'PREPARED_PARAMETER_INVALID_BIT';
    });

    assert.throws(function() {
      Mysql.param.bit(global.BigInt('18446744073709551616'));
    }, function(error) {
      return error.code === 'PREPARED_PARAMETER_BIT_RANGE';
    });

    assert.throws(function() {
      Mysql.param.year(1900);
    }, function(error) {
      return error.code === 'PREPARED_PARAMETER_YEAR_RANGE';
    });

    assert.throws(function() {
      Mysql.param.year('2026');
    }, function(error) {
      return error.code === 'PREPARED_PARAMETER_INVALID_YEAR';
    });
  },

  'rejects invalid temporal values': function() {
    assert.throws(function() {
      Mysql.param.date('2026-02-29');
    }, function(error) {
      return error.code === 'PREPARED_PARAMETER_INVALID_DATE';
    });

    assert.throws(function() {
      Mysql.param.datetime('2026-09-27 24:00:00');
    }, function(error) {
      return error.code === 'PREPARED_PARAMETER_INVALID_DATETIME';
    });

    assert.throws(function() {
      Mysql.param.time('839:00:00');
    }, function(error) {
      return error.code === 'PREPARED_PARAMETER_TIME_RANGE';
    });
  },

  'rejects out-of-range integers': function() {
    assert.throws(function() {
      Mysql.param.int8(128);
    }, function(error) {
      return error.code === 'PREPARED_PARAMETER_INTEGER_RANGE';
    });

    assert.throws(function() {
      Mysql.param.uint32(-1);
    }, function(error) {
      return error.code === 'PREPARED_PARAMETER_INTEGER_RANGE';
    });

    assert.throws(function() {
      Mysql.param.uint64('18446744073709551616');
    }, function(error) {
      return error.code === 'PREPARED_PARAMETER_INTEGER_RANGE';
    });
  },

  'requires safe number input for 64-bit integers': function() {
    assert.throws(function() {
      Mysql.param.int64(Number.MAX_SAFE_INTEGER + 1);
    }, function(error) {
      return error.code === 'PREPARED_PARAMETER_INVALID_INTEGER';
    });
  },

  'keeps decimal values exact as text': function() {
    var value = Mysql.param.decimal('12345678901234567890.123456789');

    assert.equal(value.value, '12345678901234567890.123456789');
    assert.deepStrictEqual(descriptor(value), {type: Mysql.Types.NEWDECIMAL, unsigned: false});
  },

  'distinguishes text from binary intent': function() {
    var bytes = new global.Uint8Array([0, 127, 255]);
    var binary = Mysql.param.binary(bytes);
    var text = Mysql.param.text('NuBloxSQL');

    assert.ok(Buffer.isBuffer(binary.value));
    assert.deepStrictEqual(Array.prototype.slice.call(binary.value), [0, 127, 255]);
    assert.deepStrictEqual(descriptor(binary), {type: Mysql.Types.BLOB, unsigned: false});
    assert.deepStrictEqual(descriptor(text), {type: Mysql.Types.VAR_STRING, unsigned: false});
  },

  'rejects non-finite floating point values': function() {
    assert.throws(function() {
      Mysql.param.double(Infinity);
    }, function(error) {
      return error.code === 'PREPARED_PARAMETER_INVALID_NUMBER';
    });
  }
});
