'use strict';

var assert = require('assert');
var ResultParser = require('../lib/ResultParser');
var TokenStream = require('../lib/TokenStream');

function column(typeInfo, name, flags) {
  var header = Buffer.alloc(6);
  header.writeUInt32LE(0, 0);
  header.writeUInt16LE(flags || 0, 4);
  return Buffer.concat([
    header,
    typeInfo,
    Buffer.from([name.length]),
    Buffer.from(name, 'utf16le')
  ]);
}

function fixed(type) { return Buffer.from([type]); }
function character(type, maxLength) {
  var info = Buffer.alloc(8);
  info[0] = type;
  info.writeUInt16LE(maxLength, 1);
  // Five-byte collation deliberately zeroed for parser-contract coverage.
  return info;
}
function binary(type, maxLength) {
  var info = Buffer.alloc(3);
  info[0] = type;
  info.writeUInt16LE(maxLength, 1);
  return info;
}
function variable(type, maxLength) { return Buffer.from([type, maxLength]); }

function colMetadata(columns) {
  var count = Buffer.alloc(2);
  count.writeUInt16LE(columns.length, 0);
  return Buffer.concat([Buffer.from([TokenStream.TOKENS.COLMETADATA]), count].concat(columns));
}

function done(rowCount) {
  var value = Buffer.alloc(13);
  value[0] = TokenStream.TOKENS.DONE;
  value.writeUInt16LE(TokenStream.DONE_STATUS.COUNT, 1);
  value.writeUInt16LE(0, 3);
  value.writeBigUInt64LE(BigInt(rowCount), 5);
  return value;
}

function normalRow() {
  var id = Buffer.alloc(4); id.writeInt32LE(42, 0);
  var name = Buffer.from('Stephen', 'utf16le');
  var nameLength = Buffer.alloc(2); nameLength.writeUInt16LE(name.length, 0);
  var payload = Buffer.from([0xde, 0xad, 0xbe, 0xef]);
  var payloadLength = Buffer.alloc(2); payloadLength.writeUInt16LE(payload.length, 0);
  return Buffer.concat([
    Buffer.from([TokenStream.TOKENS.ROW]),
    id,
    nameLength, name,
    payloadLength, payload
  ]);
}

function nbcRow() {
  var score = Buffer.alloc(5);
  score[0] = 4;
  score.writeInt32LE(-7, 1);
  return Buffer.concat([
    Buffer.from([TokenStream.TOKENS.NBCROW]),
    Buffer.from([0x01]), // first column null, second present
    score
  ]);
}

function main() {
  var metadata = colMetadata([
    column(fixed(ResultParser.TYPES.INT4), 'id'),
    column(character(ResultParser.TYPES.NVARCHAR, 80), 'name', 1),
    column(binary(ResultParser.TYPES.BIGVARBINARY, 32), 'payload', 1)
  ]);
  var parsed = ResultParser.parseResult(Buffer.concat([metadata, normalRow(), done(1)]));
  assert.strictEqual(parsed.success, true);
  assert.strictEqual(parsed.columns.length, 3);
  assert.strictEqual(parsed.columns[0].name, 'id');
  assert.strictEqual(parsed.columns[1].type, ResultParser.TYPES.NVARCHAR);
  assert.strictEqual(parsed.rows.length, 1);
  assert.strictEqual(parsed.rows[0].id, 42);
  assert.strictEqual(parsed.rows[0].name, 'Stephen');
  assert.deepStrictEqual(parsed.rows[0].payload, Buffer.from([0xde, 0xad, 0xbe, 0xef]));
  assert.strictEqual(parsed.rowCount, 1n);

  var nullableMetadata = colMetadata([
    column(variable(ResultParser.TYPES.INTN, 4), 'maybe', 1),
    column(variable(ResultParser.TYPES.INTN, 4), 'score', 1)
  ]);
  var compressed = ResultParser.parseResult(Buffer.concat([nullableMetadata, nbcRow(), done(1)]));
  assert.strictEqual(compressed.rows[0].maybe, null);
  assert.strictEqual(compressed.rows[0].score, -7);

  assert.throws(function () {
    ResultParser.parseResult(Buffer.from([TokenStream.TOKENS.ROW]));
  }, RangeError);

  console.log('NuBloxSQL SQL Server result token parser passed');
}

main();
