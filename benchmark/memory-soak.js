'use strict';

var Buffer = require('safe-buffer').Buffer;
var PacketWriter = require('../lib/protocol/PacketWriter');
var Parser = require('../lib/protocol/Parser');

var CYCLES = positiveInteger(process.env.BENCHMARK_MEMORY_CYCLES, 50);
var PARSER_PACKETS = positiveInteger(process.env.BENCHMARK_MEMORY_PARSER_PACKETS, 10000);
var PARSER_PAYLOAD_BYTES = positiveInteger(process.env.BENCHMARK_MEMORY_PARSER_PAYLOAD_BYTES, 32);
var PARSER_CHUNK_BYTES = positiveInteger(process.env.BENCHMARK_MEMORY_PARSER_CHUNK_BYTES, 16);
var WRITER_BYTES = positiveInteger(process.env.BENCHMARK_MEMORY_WRITER_BYTES, 1024 * 1024);
var WRITER_CHUNK_BYTES = positiveInteger(process.env.BENCHMARK_MEMORY_WRITER_CHUNK_BYTES, 64);
var parserWire = createWire(PARSER_PACKETS, PARSER_PAYLOAD_BYTES);
var writerChunk = Buffer.alloc(WRITER_CHUNK_BYTES, 0x5a);

var parserResult = profile('parser-fragmentation', function () {
  return runParserCycle();
});
var writerResult = profile('packet-writer', function () {
  return runWriterCycle();
});

process.stdout.write(JSON.stringify({
  benchmark : 'memory-soak',
  node      : process.version,
  platform  : process.platform,
  arch      : process.arch,
  gcExposed : typeof global.gc === 'function',
  cycles    : CYCLES,
  parser    : {
    packets      : PARSER_PACKETS,
    payloadBytes : PARSER_PAYLOAD_BYTES,
    chunkBytes   : PARSER_CHUNK_BYTES,
    wireBytes    : parserWire.length,
    result       : parserResult
  },
  writer    : {
    payloadBytes : WRITER_BYTES,
    chunkBytes   : WRITER_CHUNK_BYTES,
    result       : writerResult
  }
}, null, 2) + '\n');

function profile(name, runCycle) {
  collectGarbage();

  var baseline = memorySnapshot();
  var peak = baseline;
  var settled = [];
  var durations = [];

  for (var cycle = 0; cycle < CYCLES; cycle++) {
    var started = process.hrtime.bigint();
    runCycle();
    durations.push(durationMs(started));

    peak = memoryMaximum(peak, memorySnapshot());
    collectGarbage();
    settled.push(memorySnapshot());
  }

  var finalSnapshot = settled[settled.length - 1];

  return {
    workload             : name,
    meanCycleMs          : mean(durations),
    p50CycleMs           : percentile(durations, 0.50),
    p95CycleMs           : percentile(durations, 0.95),
    peakDeltaBytes       : memoryDelta(peak, baseline),
    settledDeltaBytes    : memoryDelta(finalSnapshot, baseline),
    settledDriftPerCycle : memorySlopes(settled)
  };
}

function runParserCycle() {
  var seen = 0;
  var parser;

  parser = new Parser({
    onPacket: function () {
      parser.parsePacketTerminatedBuffer();
      seen++;
    }
  });

  for (var offset = 0; offset < parserWire.length; offset += PARSER_CHUNK_BYTES) {
    parser.write(parserWire.slice(offset, Math.min(offset + PARSER_CHUNK_BYTES, parserWire.length)));
  }

  if (seen !== PARSER_PACKETS) {
    throw new Error('Memory soak expected ' + PARSER_PACKETS + ' parser packets but received ' + seen);
  }
}

function runWriterCycle() {
  var writer = new PacketWriter();
  var parser = new Parser();
  var remaining = WRITER_BYTES;

  while (remaining > 0) {
    var bytes = Math.min(remaining, writerChunk.length);
    writer.writeBuffer(bytes === writerChunk.length ? writerChunk : writerChunk.slice(0, bytes));
    remaining -= bytes;
  }

  var wire = writer.toBuffer(parser);
  var maxPayload = Math.pow(2, 24) - 1;
  var expectedPackets = Math.floor(WRITER_BYTES / maxPayload) + 1;
  var expectedLength = WRITER_BYTES + expectedPackets * 4;

  if (wire.length !== expectedLength) {
    throw new Error('Memory soak expected framed writer length ' + expectedLength + ' but received ' + wire.length);
  }
}

function collectGarbage() {
  if (global.gc) {
    global.gc();
  }
}

function memorySnapshot() {
  var usage = process.memoryUsage();

  return {
    rss          : usage.rss,
    heapUsed     : usage.heapUsed,
    external     : usage.external,
    arrayBuffers : usage.arrayBuffers
  };
}

function memoryMaximum(left, right) {
  return {
    rss          : Math.max(left.rss, right.rss),
    heapUsed     : Math.max(left.heapUsed, right.heapUsed),
    external     : Math.max(left.external, right.external),
    arrayBuffers : Math.max(left.arrayBuffers, right.arrayBuffers)
  };
}

function memoryDelta(after, before) {
  return {
    rss          : after.rss - before.rss,
    heapUsed     : after.heapUsed - before.heapUsed,
    external     : after.external - before.external,
    arrayBuffers : after.arrayBuffers - before.arrayBuffers
  };
}

function memorySlopes(samples) {
  return {
    rss          : slope(samples.map(function (sample) { return sample.rss; })),
    heapUsed     : slope(samples.map(function (sample) { return sample.heapUsed; })),
    external     : slope(samples.map(function (sample) { return sample.external; })),
    arrayBuffers : slope(samples.map(function (sample) { return sample.arrayBuffers; }))
  };
}

function slope(values) {
  if (values.length < 2) {
    return 0;
  }

  var count = values.length;
  var sumX = 0;
  var sumY = 0;
  var sumXY = 0;
  var sumXX = 0;

  for (var i = 0; i < count; i++) {
    sumX += i;
    sumY += values[i];
    sumXY += i * values[i];
    sumXX += i * i;
  }

  var denominator = count * sumXX - sumX * sumX;

  return denominator === 0 ? 0 : (count * sumXY - sumX * sumY) / denominator;
}

function durationMs(started) {
  return Number(process.hrtime.bigint() - started) / 1000000;
}

function mean(values) {
  return values.reduce(function (total, value) {
    return total + value;
  }, 0) / values.length;
}

function percentile(values, ratio) {
  var sorted = values.slice().sort(function (left, right) {
    return left - right;
  });
  var index = Math.min(sorted.length - 1, Math.floor(sorted.length * ratio));

  return sorted[index];
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
