'use strict';

var Buffer = require('safe-buffer').Buffer;
var PacketWriter = require('../lib/protocol/PacketWriter');
var Parser = require('../lib/protocol/Parser');

var TOTAL_BYTES = positiveInteger(process.env.BENCHMARK_WRITER_BYTES, 1024 * 1024);
var CHUNK_BYTES = positiveInteger(process.env.BENCHMARK_WRITER_CHUNK_BYTES, 32);
var ROUNDS = positiveInteger(process.env.BENCHMARK_ROUNDS, 25);
var chunk = Buffer.alloc(CHUNK_BYTES, 0x5a);
var durations = [];
var heapBefore;
var heapAfter;

console.log('NuBloxSQL PacketWriter allocation benchmark');
console.log('Node: %s', process.version);
console.log('Payload bytes: %d', TOTAL_BYTES);
console.log('Write chunk bytes: %d', CHUNK_BYTES);
console.log('Rounds: %d', ROUNDS);

if (global.gc) {
  global.gc();
}
heapBefore = process.memoryUsage().heapUsed;

for (var round = 0; round < ROUNDS; round++) {
  if (global.gc) {
    global.gc();
  }

  var writer = new PacketWriter();
  var parser = new Parser();
  var remaining = TOTAL_BYTES;
  var start = process.hrtime.bigint();

  while (remaining > 0) {
    var bytes = Math.min(remaining, chunk.length);
    writer.writeBuffer(bytes === chunk.length ? chunk : chunk.slice(0, bytes));
    remaining -= bytes;
  }

  var wire = writer.toBuffer(parser);
  var elapsedMs = Number(process.hrtime.bigint() - start) / 1e6;

  if (wire.length !== TOTAL_BYTES + (Math.floor(TOTAL_BYTES / (Math.pow(2, 24) - 1)) + 1) * 4) {
    throw new Error('Unexpected framed payload length: ' + wire.length);
  }

  durations.push(elapsedMs);
}

if (global.gc) {
  global.gc();
}
heapAfter = process.memoryUsage().heapUsed;

var sum = durations.reduce(function(total, value) {
  return total + value;
}, 0);
var meanMs = sum / durations.length;
var minMs = Math.min.apply(Math, durations);
var mib = (TOTAL_BYTES * ROUNDS) / 1024 / 1024;
var throughput = mib / (sum / 1000);

console.log('');
console.log('mean ms\tmin ms\tMiB/s\theap delta');
console.log('%s\t%s\t%s\t%d', meanMs.toFixed(2), minMs.toFixed(2), throughput.toFixed(2), heapAfter - heapBefore);

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
