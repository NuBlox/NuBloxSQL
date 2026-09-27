'use strict';

var assert = require('assert');
var Buffer = require('safe-buffer').Buffer;
var InboundPacketLimiter = require('../../lib/protocol/InboundPacketLimiter');
var Parser = require('../../lib/protocol/Parser');

var DEFAULT_ITERATIONS = 5000;
var DEFAULT_MAX_PAYLOAD = 1024;
var DEFAULT_SEED = 0x4e55424c;

var iterations = positiveInteger(process.env.NUBLOX_FUZZ_ITERATIONS, DEFAULT_ITERATIONS);
var maxPayload = positiveInteger(process.env.NUBLOX_FUZZ_MAX_PAYLOAD, DEFAULT_MAX_PAYLOAD);
var seed = unsignedInteger(process.env.NUBLOX_FUZZ_SEED, DEFAULT_SEED);
var random = xorshift32(seed);

fuzzClassicProtocolParser();
fuzzInboundPacketLimiter();

console.log(
  'NuBloxSQL protocol fuzz completed: %d parser cases + %d limiter cases (seed=%d)',
  iterations,
  iterations,
  seed
);

function fuzzClassicProtocolParser() {
  for (var iteration = 0; iteration < iterations; iteration++) {
    var packetCount = 1 + nextInt(random, 4);
    var sequence = 0;
    var packets = [];

    for (var packetIndex = 0; packetIndex < packetCount; packetIndex++) {
      var payloadLength = nextInt(random, maxPayload + 1);
      var packet = Buffer.allocUnsafe(4 + payloadLength);

      writeUInt24(packet, payloadLength, 0);
      packet[3] = sequence;
      sequence = (sequence + 1) & 0xff;

      fillRandom(packet, 4, random);
      packets.push(packet);
    }

    var wire = Buffer.concat(packets);

    // Exercise malformed/truncated boundaries without permitting unbounded
    // allocations. Sequence mutation is also useful because it must surface
    // as a controlled protocol error rather than an uncaught exception.
    if (wire.length > 4 && nextInt(random, 8) === 0) {
      wire[3] = (wire[3] + 1 + nextInt(random, 254)) & 0xff;
    }

    if (wire.length > 0 && nextInt(random, 8) === 0) {
      wire = wire.slice(0, nextInt(random, wire.length + 1));
    }

    var parserErrors = [];
    var parser = new Parser({
      config   : {supportBigNumbers: true},
      onError  : function onError(error) {
        assertControlledParserError(error);
        parserErrors.push(error);
      },
      onPacket : function onPacket() {
        // Consume the full payload using both buffer and string paths. The
        // generated payload is deliberately bounded, making any unexpected
        // large allocation a regression in parser state handling.
        if (nextInt(random, 2) === 0) {
          parser.parsePacketTerminatedBuffer();
        } else {
          parser.parsePacketTerminatedString();
        }
      }
    });

    var offset = 0;
    while (offset < wire.length) {
      var chunkLength = 1 + nextInt(random, Math.min(64, wire.length - offset));
      var chunk = wire.slice(offset, offset + chunkLength);
      offset += chunkLength;

      try {
        parser.write(chunk);
      } catch (error) {
        var observed = parserErrors.map(function mapError(item) { return item.code; }).join(',');
        error.message = 'parser fuzz case ' + iteration + ' failed with seed ' + seed +
          ' after controlled errors [' + observed + ']: ' + error.message;
        throw error;
      }
    }
  }
}

function fuzzInboundPacketLimiter() {
  for (var iteration = 0; iteration < iterations; iteration++) {
    var limit = 64 + nextInt(random, 4096);
    var limiter = new InboundPacketLimiter(limit);
    var declaredLength = nextInt(random, limit * 2 + 1);
    var availablePayload = Math.min(declaredLength, nextInt(random, maxPayload + 1));
    var wire = Buffer.allocUnsafe(4 + availablePayload);

    writeUInt24(wire, declaredLength, 0);
    wire[3] = nextInt(random, 256);
    fillRandom(wire, 4, random);

    var offset = 0;
    var rejected = false;

    while (offset < wire.length && !rejected) {
      var chunkLength = 1 + nextInt(random, Math.min(32, wire.length - offset));
      var chunk = wire.slice(offset, offset + chunkLength);
      offset += chunkLength;

      try {
        limiter.write(chunk);
      } catch (error) {
        assert.strictEqual(error.code, 'PROTOCOL_INBOUND_PACKET_TOO_LARGE');
        assert.strictEqual(error.fatal, true);
        assert.strictEqual(error.limit, limit);
        assert.ok(error.packetLength > limit);
        rejected = true;
      }
    }

    if (declaredLength > limit) {
      assert.strictEqual(rejected, true, 'oversized declared packet was not rejected');
    } else {
      assert.strictEqual(rejected, false, 'in-limit declared packet was unexpectedly rejected');
    }
  }
}

function assertControlledParserError(error) {
  assert.ok(error instanceof Error, 'parser onError must receive Error instances');
  assert.strictEqual(typeof error.code, 'string', 'parser errors must expose a code');
  assert.ok(
    error.code.indexOf('PARSER_') === 0 || error.code === 'PROTOCOL_PACKETS_OUT_OF_ORDER',
    'unexpected parser error code: ' + error.code
  );
}

function fillRandom(buffer, start, rng) {
  for (var index = start; index < buffer.length; index++) {
    buffer[index] = nextInt(rng, 256);
  }
}

function writeUInt24(buffer, value, offset) {
  buffer[offset] = value & 0xff;
  buffer[offset + 1] = (value >>> 8) & 0xff;
  buffer[offset + 2] = (value >>> 16) & 0xff;
}

function nextInt(rng, maxExclusive) {
  if (maxExclusive <= 1) {
    return 0;
  }

  return Math.floor(rng() * maxExclusive);
}

function xorshift32(initialSeed) {
  var state = initialSeed >>> 0;

  if (state === 0) {
    state = DEFAULT_SEED;
  }

  return function randomNumber() {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 0x100000000;
  };
}

function positiveInteger(value, fallback) {
  if (value === undefined || value === '') {
    return fallback;
  }

  var parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new TypeError('fuzz iteration and size settings must be positive safe integers');
  }

  return parsed;
}

function unsignedInteger(value, fallback) {
  if (value === undefined || value === '') {
    return fallback >>> 0;
  }

  var parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > 0xffffffff) {
    throw new TypeError('NUBLOX_FUZZ_SEED must be an unsigned 32-bit integer');
  }

  return parsed >>> 0;
}
