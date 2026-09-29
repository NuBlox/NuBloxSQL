'use strict';

var assert = require('assert');
var ResultStream = require('../lib/ResultStream');

function columnMetadataInt4(name) {
  var encodedName = Buffer.from(name, 'utf16le');
  var value = Buffer.allocUnsafe(1 + 2 + 4 + 2 + 1 + 1 + encodedName.length);
  var offset = 0;
  value[offset++] = ResultStream.TOKENS.COLMETADATA;
  value.writeUInt16LE(1, offset); offset += 2;
  value.writeUInt32LE(0, offset); offset += 4;
  value.writeUInt16LE(0, offset); offset += 2;
  value[offset++] = ResultStream.TYPES.INT4;
  value[offset++] = name.length;
  encodedName.copy(value, offset);
  return value;
}

function rowInt4(value) {
  var row = Buffer.allocUnsafe(5);
  row[0] = ResultStream.TOKENS.ROW;
  row.writeInt32LE(value, 1);
  return row;
}

function done(rowCount) {
  var value = Buffer.alloc(13);
  value[0] = ResultStream.TOKENS.DONE;
  value.writeUInt16LE(0x0010, 1);
  value.writeUInt16LE(0, 3);
  value.writeBigUInt64LE(BigInt(rowCount), 5);
  return value;
}

var response = ResultStream.parse(Buffer.concat([
  columnMetadataInt4('answer'),
  rowInt4(42),
  done(1)
]));

assert.strictEqual(response.columns.length, 1);
assert.strictEqual(response.columns[0].name, 'answer');
assert.strictEqual(response.columns[0].type, ResultStream.TYPES.INT4);
assert.deepStrictEqual(response.rows, [{ answer: 42 }]);
assert.strictEqual(response.rowCount, 1n);
assert.strictEqual(response.done.error, false);

assert.throws(function () {
  ResultStream.parse(Buffer.from([0x99]));
}, /Unsupported SQL Server result token/);

console.log('NuBloxSQL SQL Server result-stream foundation passed');
