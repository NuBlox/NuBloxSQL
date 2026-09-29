'use strict';

var MAX_BUFFER_LENGTH = require('buffer').constants.MAX_LENGTH;
var PLP_NULL = 0xffffffffffffffffn;
var PLP_UNKNOWN = 0xfffffffffffffffen;

function need(buffer, offset, count, label) {
  if (offset + count > buffer.length) throw new RangeError('Incomplete SQL Server ' + label);
}

function read(buffer, offset) {
  need(buffer, offset, 8, 'PLP total length');
  var declared = buffer.readBigUInt64LE(offset);
  offset += 8;
  if (declared === PLP_NULL) return { value: null, offset: offset, declaredLength: null, unknownLength: false };
  var unknown = declared === PLP_UNKNOWN;
  if (!unknown && declared > BigInt(MAX_BUFFER_LENGTH)) throw new RangeError('SQL Server PLP value exceeds Node.js maximum Buffer length');

  var chunks = [];
  var total = 0;
  while (true) {
    need(buffer, offset, 4, 'PLP chunk length');
    var length = buffer.readUInt32LE(offset);
    offset += 4;
    if (length === 0) break;
    if (total + length > MAX_BUFFER_LENGTH) throw new RangeError('SQL Server PLP value exceeds Node.js maximum Buffer length');
    need(buffer, offset, length, 'PLP chunk');
    chunks.push(buffer.subarray(offset, offset + length));
    offset += length;
    total += length;
  }

  if (!unknown && BigInt(total) !== declared) {
    throw new RangeError('SQL Server PLP declared length ' + declared + ' does not match chunk bytes ' + total);
  }
  return {
    value: total === 0 ? Buffer.alloc(0) : Buffer.concat(chunks, total),
    offset: offset,
    declaredLength: unknown ? null : declared,
    unknownLength: unknown
  };
}

exports.PLP_NULL = PLP_NULL;
exports.PLP_UNKNOWN = PLP_UNKNOWN;
exports.read = read;
