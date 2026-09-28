'use strict';

var assert = require('assert');
var common = require('../common');
var path = require('path');
var test = require('utest');

var ClientConstants = require(path.resolve(common.lib, 'protocol/constants/client'));
var ComStmtExecutePacket = require(path.resolve(common.lib, 'protocol/packets/ComStmtExecutePacket'));
var ComStmtFetchPacket = require(path.resolve(common.lib, 'protocol/packets/ComStmtFetchPacket'));

function numberWriter() {
  var numbers = [];

  return {
    numbers : numbers,
    writer  : {
      writeUnsignedNumber: function writeUnsignedNumber(bytes, value) {
        numbers.push([bytes, value]);
      },
      writeLengthCodedNumber: function writeLengthCodedNumber(value) {
        numbers.push(['lenenc', value]);
      }
    }
  };
}

test('PreparedCursorProtocol', {
  'encodes read-only cursor flag in COM_STMT_EXECUTE': function() {
    var target = numberWriter();
    var packet = new ComStmtExecutePacket(42, [], {}, 0, 0x01);

    packet.write(target.writer);

    assert.deepStrictEqual(target.numbers, [
      [1, 0x17],
      [4, 42],
      [1, 0x01],
      [4, 1]
    ]);
  },

  'preserves query-attribute flag when opening a cursor': function() {
    var target = numberWriter();
    var packet = new ComStmtExecutePacket(
      42,
      [],
      {},
      ClientConstants.CLIENT_QUERY_ATTRIBUTES,
      0x01
    );

    packet.write(target.writer);

    assert.deepStrictEqual(target.numbers, [
      [1, 0x17],
      [4, 42],
      [1, 0x09],
      [4, 1],
      ['lenenc', 0]
    ]);
  },

  'preserves non-cursor execute wire compatibility by default': function() {
    var target = numberWriter();
    var packet = new ComStmtExecutePacket(42, [], {}, 0);

    packet.write(target.writer);

    assert.deepStrictEqual(target.numbers, [
      [1, 0x17],
      [4, 42],
      [1, 0x00],
      [4, 1]
    ]);
  },

  'encodes COM_STMT_FETCH statement and row count': function() {
    var target = numberWriter();
    var packet = new ComStmtFetchPacket(99, 512);

    packet.write(target.writer);

    assert.deepStrictEqual(target.numbers, [
      [1, 0x1c],
      [4, 99],
      [4, 512]
    ]);
  }
});
