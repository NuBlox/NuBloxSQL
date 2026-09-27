'use strict';

var Buffer = require('safe-buffer').Buffer;
var Parser = require('../lib/protocol/Parser');

var PACKETS = positiveInteger(process.env.BENCHMARK_PACKETS, 100000);
var PAYLOAD_BYTES = positiveInteger(process.env.BENCHMARK_PAYLOAD_BYTES, 32);
var CHUNK_SIZES = parseChunkSizes(process.env.BENCHMARK_CHUNK_SIZES || '1,4,16,64,1024,65536');
var ROUNDS = positiveInteger(process.env.BENCHMARK_ROUNDS, 5);

var wire = createWire(PACKETS, PAYLOAD_BYTES);
var results = [];

console.log('NuBloxSQL parser fragmentation benchmark');
console.log('Node: %s', process.version);
console.log('Packets: %d', PACKETS);
console.log('Payload bytes: %d', PAYLOAD_BYTES);
console.log('Wire bytes: %d', wire.length);
console.log('Rounds: %d', ROUNDS);

for (var i = 0; i < CHUNK_SIZES.length; i++) {
  results.push(runCase(CHUNK_SIZES[i]));
}

console.log('');
console.log('chunk\tpackets/s\tMiB/s\tmean ms\tmin ms\theap delta');
for (var i = 0; i < results.length; i++) {
  var result = results[i];
  console.log(
    '%d\t%d\t%s\t%s\t%s\t%d',
    result.chunkSize,
    Math.round(result.packetsPerSecond),
    result.mibPerSecond.toFixed(2),
    result.meanMs.toFixed(2),
    result.minMs.toFixed(2),
    result.heapDelta
  );
}

function runCase(chunkSize) {
  var durations = [];
  var heapBefore = process.memoryUsage().heapUsed;

  for (var round = 0; round < ROUNDS; round++) {
    if (global.gc) {
      global.gc();
    }

    var seen = 0;
    var parser;
    parser = new Parser({
      onPacket: function() {
        parser.parsePacketTerminatedBuffer();
        seen++;
      }
    });

    var start = process.hrtime.bigint();
    for (var offset = 0; offset < wire.length; offset += chunkSize) {
      parser.write(wire.slice(offset, Math.min(offset + chunkSize, wire.length)));
    }
    var elapsedMs = Number(process.hrtime.bigint() - start) / 1e6;

    if (seen !== PACKETS) {
      throw new Error('Expected ' + PACKETS + ' packets; parsed ' + seen);
    }

    durations.push(elapsedMs);
  }

  var heapAfter = process.memoryUsage().heapUsed;
  var sum = durations.reduce(function(total, value) { return total + value; }, 0);
  var meanMs = sum / durations.length;
  var minMs = Math.min.apply(Math, durations);
  var seconds = meanMs / 1000;

  return {
    chunkSize        : chunkSize,
    meanMs           : meanMs,
    minMs            : minMs,
    packetsPerSecond : PACKETS / seconds,
    mibPerSecond     : (wire.length / 1024 / 1024) / seconds,
    heapDelta        : heapAfter - heapBefore
  };
}

function createWire(packetCount, payloadBytes) {
  var packetSize = payloadBytes + 4;
  var wire = Buffer.allocUnsafe(packetSize * packetCount);
  var offset = 0;

  for (var packet = 0; packet < packetCount; packet++) {
    writeUInt24(wire, payloadBytes, offset);
    wire[offset + 3] = packet & 0xff;
    wire.fill(packet & 0xff, offset + 4, offset + packetSize);
    offset += packetSize;
  }

  return wire;
}

function writeUInt24(buffer, value, offset) {
  buffer[offset] = value & 0xff;
  buffer[offset + 1] = (value >>> 8) & 0xff;
  buffer[offset + 2] = (value >>> 16) & 0xff;
}

function positiveInteger(value, fallback) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }

  var number = Number(value);
  if (!Number.isInteger(number) || number <= 0) {
    throw new TypeError('Benchmark values must be positive integers');
  }

  return number;
}

function parseChunkSizes(value) {
  var values = String(value).split(',').map(function(item) {
    return positiveInteger(item.trim());
  });

  if (values.length === 0) {
    throw new TypeError('BENCHMARK_CHUNK_SIZES must contain at least one size');
  }

  return values;
}
