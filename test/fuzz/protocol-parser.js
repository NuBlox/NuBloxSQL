'use strict';

var assert = require('assert');
var path = require('path');
var seedrandom = require('seedrandom');
var common = require('../common');

var Parser = require(path.resolve(common.lib, 'protocol/Parser'));

var seed = process.env.FUZZ_SEED || 'nubloxsql-protocol-v1';
var cases = positiveInteger(process.env.FUZZ_CASES, 2000);
var random = seedrandom(seed);

fuzzValidPacketFraming();
fuzzMalformedLengthCodedValues();
fuzzSequenceValidation();

console.log('Protocol parser fuzz passed: seed=%s cases=%d', seed, cases);

function fuzzValidPacketFraming() {
  for (var iteration = 0; iteration < cases; iteration++) {
    var packetCount = randomInteger(1, 8);
    var expected = [];
    var frames = [];

    for (var sequenceId = 0; sequenceId < packetCount; sequenceId++) {
      var payload = randomBuffer(randomInteger(0, 2048));
      expected.push(payload);
      frames.push(packet(payload, sequenceId));
    }

    var observed = [];
    var errors = [];
    var parser = new Parser({
      onError: function(error) {
        errors.push(error);
      },
      onPacket: function() {
        observed.push(parser.parsePacketTerminatedBuffer());
      }
    });

    feedRandomFragments(parser, Buffer.concat(frames));

    assert.strictEqual(errors.length, 0, describeFailure('valid framing emitted an error', iteration, errors[0]));
    assert.strictEqual(observed.length, expected.length, describeFailure('packet count mismatch', iteration));

    for (var i = 0; i < expected.length; i++) {
      assert.deepStrictEqual(observed[i], expected[i], describeFailure('payload mismatch', iteration));
    }
  }
}

function fuzzMalformedLengthCodedValues() {
  for (var iteration = 0; iteration < cases; iteration++) {
    var declaredLength = randomInteger(4096, 65535);
    var remainder = randomBuffer(randomInteger(0, 32));
    var prefix = iteration % 3;
    var payload;

    if (prefix === 0) {
      payload = Buffer.concat([
        Buffer.from([0xfc, declaredLength & 0xff, (declaredLength >>> 8) & 0xff]),
        remainder
      ]);
    } else if (prefix === 1) {
      payload = Buffer.concat([
        Buffer.from([
          0xfd,
          declaredLength & 0xff,
          (declaredLength >>> 8) & 0xff,
          (declaredLength >>> 16) & 0xff
        ]),
        remainder
      ]);
    } else {
      var encoded = Buffer.alloc(9);
      encoded[0] = 0xfe;
      encoded.writeUInt32LE(declaredLength, 1);
      encoded.writeUInt32LE(0, 5);
      payload = Buffer.concat([encoded, remainder]);
    }

    var errors = [];
    var parser = new Parser({
      onError: function(error) {
        errors.push(error);
      },
      onPacket: function() {
        parser.parseLengthCodedBuffer();
      }
    });

    feedRandomFragments(parser, packet(payload, 0));

    assert.strictEqual(errors.length, 1, describeFailure('malformed length did not fail exactly once', iteration));
    assert.strictEqual(
      errors[0].code,
      'PARSER_READ_PAST_END',
      describeFailure('malformed length escaped packet-boundary error handling', iteration, errors[0])
    );
  }
}

function fuzzSequenceValidation() {
  var sequenceCases = Math.max(100, Math.floor(cases / 10));

  for (var iteration = 0; iteration < sequenceCases; iteration++) {
    var errors = [];
    var parser = new Parser({
      onError: function(error) {
        errors.push(error);
      },
      onPacket: function() {
        parser.parsePacketTerminatedBuffer();
      }
    });
    var wrongSequence = randomInteger(1, 255);

    feedRandomFragments(parser, packet(randomBuffer(randomInteger(0, 128)), wrongSequence));

    assert.ok(errors.length >= 1, describeFailure('out-of-order sequence was accepted', iteration));
    assert.strictEqual(
      errors[0].code,
      'PROTOCOL_PACKETS_OUT_OF_ORDER',
      describeFailure('unexpected sequence error', iteration, errors[0])
    );
  }
}

function packet(payload, sequenceId) {
  var header = Buffer.alloc(4);
  header[0] = payload.length & 0xff;
  header[1] = (payload.length >>> 8) & 0xff;
  header[2] = (payload.length >>> 16) & 0xff;
  header[3] = sequenceId & 0xff;
  return Buffer.concat([header, payload]);
}

function feedRandomFragments(parser, buffer) {
  var offset = 0;

  while (offset < buffer.length) {
    var remaining = buffer.length - offset;
    var size = Math.min(remaining, randomInteger(1, 128));
    parser.write(buffer.slice(offset, offset + size));
    offset += size;
  }
}

function randomBuffer(length) {
  var buffer = Buffer.allocUnsafe(length);

  for (var i = 0; i < length; i++) {
    buffer[i] = randomInteger(0, 255);
  }

  return buffer;
}

function randomInteger(min, max) {
  return min + Math.floor(random() * (max - min + 1));
}

function positiveInteger(value, fallback) {
  if (value === undefined) {
    return fallback;
  }

  var number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) {
    throw new TypeError('FUZZ_CASES must be a positive safe integer');
  }

  return number;
}

function describeFailure(message, iteration, error) {
  return message + ' (seed=' + seed + ', iteration=' + iteration +
    (error && error.code ? ', code=' + error.code : '') + ')';
}
