'use strict';

var assert = require('assert');
var Buffer = require('safe-buffer').Buffer;
var Binlog = require('../../../binlog');
var Crc32  = require('../../../lib/binlog/Crc32');
var test   = require('utest');

function event(type, payload, checksumBytes, options) {
  options = options || {};
  payload = payload || Buffer.alloc(0);
  checksumBytes = checksumBytes || 0;

  var size = 19 + payload.length + checksumBytes;
  var buffer = Buffer.alloc(size);

  buffer.writeUInt32LE(1700000000, 0);
  buffer[4] = type;
  buffer.writeUInt32LE(7, 5);
  buffer.writeUInt32LE(size, 9);
  buffer.writeUInt32LE(1234, 13);
  buffer.writeUInt16LE(options.flags || 0, 17);
  payload.copy(buffer, 19);

  if (checksumBytes === 4) {
    buffer.writeUInt32LE(Crc32.compute(buffer, size - 4, type === Binlog.EventTypes.FORMAT_DESCRIPTION_EVENT), size - 4);
  }

  return buffer;
}

function formatDescription(algorithm, options) {
  options = options || {};

  var payload = Buffer.alloc(61);
  payload.writeUInt16LE(4, 0);
  payload.write(options.version || '8.4.0-nublox', 2, 'ascii');
  payload.writeUInt32LE(1700000001, 52);
  payload[56] = 19;
  payload[57] = 13;
  payload[58] = 0;
  payload[59] = 8;
  payload[60] = algorithm;

  var buffer = event(Binlog.EventTypes.FORMAT_DESCRIPTION_EVENT, payload, 4);

  if (options.setInUseAfterChecksum) {
    buffer.writeUInt16LE(buffer.readUInt16LE(17) | 1, 17);
  }

  return buffer;
}

function crcEvent(type, payload) {
  return event(type, payload, 4);
}

test('Binlog checksum handling', {
  'implements the standard CRC32 test vector': function() {
    assert.equal(Crc32.compute(Buffer.from('123456789'), 9, false), 0xcbf43926);
  },

  'discovers CRC32 from a checksum-aware format description event': function() {
    var decoder = Binlog.createDecoder({checksumBytes: 'auto'});
    var decoded = decoder.decode(formatDescription(1));

    assert.equal(decoder.checksumAlgorithm, 'crc32');
    assert.equal(decoder.checksumBytes, 4);
    assert.equal(decoded.checksumAlgorithm, 'crc32');
    assert.equal(decoded.checksumAlgorithmCode, 1);
    assert.equal(decoded.checksumVerified, true);
    assert.equal(decoded.checksum.length, 4);
    assert.deepEqual(decoded.eventHeaderLengths, Buffer.from([13, 0, 8]));
  },

  'verifies following CRC32 events after format discovery': function() {
    var decoder = Binlog.createDecoder({checksumBytes: 'auto'});
    decoder.decode(formatDescription(1));

    var decoded = decoder.decode(crcEvent(99, Buffer.from([1, 2, 3])));

    assert.deepEqual(decoded.payload, Buffer.from([1, 2, 3]));
    assert.equal(decoded.checksumAlgorithm, 'crc32');
    assert.equal(decoded.checksumVerified, true);
  },

  'rejects corrupt CRC32 events deterministically': function() {
    var decoder = Binlog.createDecoder({checksumBytes: 'auto'});
    decoder.decode(formatDescription(1));

    var buffer = crcEvent(99, Buffer.from([1, 2, 3]));
    buffer[19] ^= 0xff;

    assert.throws(function() {
      decoder.decode(buffer);
    }, function(error) {
      return error.code === 'BINLOG_CHECKSUM_MISMATCH' &&
        Number.isInteger(error.incoming) &&
        Number.isInteger(error.computed);
    });
  },

  'masks the mutable binlog-in-use flag when verifying the format description event': function() {
    var decoder = Binlog.createDecoder({checksumBytes: 'auto'});
    var decoded = decoder.decode(formatDescription(1, {setInUseAfterChecksum: true}));

    assert.equal(decoded.flags & 1, 1);
    assert.equal(decoded.checksumVerified, true);
  },

  'learns checksum-off while still validating the format description CRC': function() {
    var decoder = Binlog.createDecoder({checksumBytes: 'auto'});
    var decodedFde = decoder.decode(formatDescription(0));

    assert.equal(decoder.checksumAlgorithm, 'off');
    assert.equal(decoder.checksumBytes, 0);
    assert.equal(decodedFde.checksumAlgorithmCode, 0);
    assert.equal(decodedFde.checksumVerified, true);

    var decoded = decoder.decode(event(99, Buffer.from([9, 8, 7])));
    assert.equal(decoded.checksum, null);
    assert.deepEqual(decoded.payload, Buffer.from([9, 8, 7]));
  },

  'leaves pre-checksum server format descriptions checksum-free': function() {
    var decoder = Binlog.createDecoder({checksumBytes: 'auto'});
    var payload = Buffer.alloc(60);

    payload.writeUInt16LE(4, 0);
    payload.write('5.5.62-nublox', 2, 'ascii');
    payload.writeUInt32LE(1700000001, 52);
    payload[56] = 19;
    payload[57] = 13;
    payload[58] = 0;
    payload[59] = 8;

    var decoded = decoder.decode(event(Binlog.EventTypes.FORMAT_DESCRIPTION_EVENT, payload));

    assert.equal(decoder.checksumAlgorithm, 'undefined');
    assert.equal(decoder.checksumBytes, 0);
    assert.equal(decoded.checksumVerified, false);
    assert.deepEqual(decoded.eventHeaderLengths, Buffer.from([13, 0, 8]));
  },

  'rejects unsupported checksum algorithms before decoding payload': function() {
    var decoder = Binlog.createDecoder({checksumBytes: 'auto'});

    assert.throws(function() {
      decoder.decode(formatDescription(7));
    }, function(error) {
      return error.code === 'BINLOG_CHECKSUM_UNSUPPORTED_ALGORITHM' && error.algorithm === 7;
    });
  }
});
