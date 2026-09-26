'use strict';

var assert = require('assert');
var common = require('../common');
var path = require('path');
var test = require('utest');

var BinaryCodec = require(path.resolve(common.lib, 'protocol/BinaryCodec'));
var Mysql = require(path.resolve(common.lib, '../index'));

function descriptor(parameter) {
  return BinaryCodec.describeParameter(parameter);
}

test('TypedParameter', {
  'exports explicit prepared parameter constructors': function() {
    assert.equal(typeof Mysql.param, 'object');
    assert.equal(typeof Mysql.param.int8, 'function');
    assert.equal(typeof Mysql.param.uint64, 'function');
    assert.equal(typeof Mysql.param.binary, 'function');
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
