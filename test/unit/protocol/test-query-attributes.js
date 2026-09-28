'use strict';

var assert = require('assert');
var path = require('path');

var ClientConstants = require(path.resolve(__dirname, '../../../lib/protocol/constants/client'));
var ComQueryPacket = require(path.resolve(__dirname, '../../../lib/protocol/packets/ComQueryPacket'));
var ComStmtExecutePacket = require(path.resolve(__dirname, '../../../lib/protocol/packets/ComStmtExecutePacket'));
var PacketWriter = require(path.resolve(__dirname, '../../../lib/protocol/PacketWriter'));

var QA = ClientConstants.CLIENT_QUERY_ATTRIBUTES;

var legacyQuery = payload(new ComQueryPacket('SELECT 1', {ignored: 'value'}, 0));
assert.deepStrictEqual(legacyQuery, Buffer.concat([
  Buffer.from([0x03]),
  Buffer.from('SELECT 1')
]));

var emptyAttributeQuery = payload(new ComQueryPacket('SELECT 1', {}, QA));
assert.deepStrictEqual(emptyAttributeQuery, Buffer.concat([
  Buffer.from([0x03, 0x00, 0x01]),
  Buffer.from('SELECT 1')
]));

var attributedQuery = payload(new ComQueryPacket('SELECT 1', {
  request_id : 'abc',
  raw        : Buffer.from([0xde, 0xad])
}, QA));

var expectedQueryPrefix = Buffer.concat([
  Buffer.from([
    0x03,
    0x02,
    0x01,
    0x00,
    0x01,
    0xfd,
    0x00,
    0x0a
  ]),
  Buffer.from('request_id'),
  Buffer.from([0xfd, 0x00, 0x03]),
  Buffer.from('raw'),
  Buffer.from([0x03]),
  Buffer.from('abc'),
  Buffer.from([0x02, 0xde, 0xad])
]);
assert.deepStrictEqual(
  attributedQuery.slice(0, expectedQueryPrefix.length),
  expectedQueryPrefix
);
assert.strictEqual(attributedQuery.slice(expectedQueryPrefix.length).toString(), 'SELECT 1');

var legacyExecute = payload(new ComStmtExecutePacket(7, [], {ignored: 'value'}, 0));
assert.deepStrictEqual(legacyExecute, Buffer.from([
  0x17,
  0x07, 0x00, 0x00, 0x00,
  0x00,
  0x01, 0x00, 0x00, 0x00
]));

var emptyAttributeExecute = payload(new ComStmtExecutePacket(7, [], {}, QA));
assert.deepStrictEqual(emptyAttributeExecute, Buffer.from([
  0x17,
  0x07, 0x00, 0x00, 0x00,
  0x08,
  0x01, 0x00, 0x00, 0x00,
  0x00
]));

var attributedExecute = payload(new ComStmtExecutePacket(7, [2], {
  traceparent: 'trace-value'
}, QA));

assert.strictEqual(attributedExecute[0], 0x17);
assert.strictEqual(attributedExecute[5], 0x08);
assert.strictEqual(attributedExecute[10], 0x02);
assert.strictEqual(attributedExecute[11], 0x00);
assert.strictEqual(attributedExecute[12], 0x01);
assert.strictEqual(attributedExecute[13], 0x05);
assert.strictEqual(attributedExecute[14], 0x00);
assert.strictEqual(attributedExecute[15], 0x00);
assert.strictEqual(attributedExecute[16], 0xfd);
assert.strictEqual(attributedExecute[17], 0x00);
assert.strictEqual(attributedExecute[18], 0x0b);
assert.strictEqual(attributedExecute.slice(19, 30).toString(), 'traceparent');

function payload(packet) {
  var writer = new PacketWriter();
  var parser = {
    incrementPacketNumber: function incrementPacketNumber() {
      return 0;
    }
  };

  packet.write(writer);
  return writer.toBuffer(parser).slice(4);
}
