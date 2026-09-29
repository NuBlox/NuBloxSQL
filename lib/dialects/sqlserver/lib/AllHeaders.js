'use strict';

var HEADER_TYPE_TRANSACTION_DESCRIPTOR = 0x0002;
var TRANSACTION_HEADER_LENGTH = 18;
var TOTAL_LENGTH = 22;

function transaction(transactionDescriptor, outstandingRequestCount) {
  if (transactionDescriptor === undefined || transactionDescriptor === null) transactionDescriptor = 0n;
  if (typeof transactionDescriptor === 'number') transactionDescriptor = BigInt(transactionDescriptor);
  if (typeof transactionDescriptor !== 'bigint' || transactionDescriptor < 0n || transactionDescriptor > 0xffffffffffffffffn) throw new RangeError('SQL Server transaction descriptor must be an unsigned 64-bit integer');
  if (outstandingRequestCount === undefined) outstandingRequestCount = 1;
  if (!Number.isInteger(outstandingRequestCount) || outstandingRequestCount < 0 || outstandingRequestCount > 0xffffffff) throw new RangeError('SQL Server outstanding request count must be an unsigned 32-bit integer');
  var buffer = Buffer.alloc(TOTAL_LENGTH);
  buffer.writeUInt32LE(TOTAL_LENGTH, 0);
  buffer.writeUInt32LE(TRANSACTION_HEADER_LENGTH, 4);
  buffer.writeUInt16LE(HEADER_TYPE_TRANSACTION_DESCRIPTOR, 8);
  buffer.writeBigUInt64LE(transactionDescriptor, 10);
  buffer.writeUInt32LE(outstandingRequestCount, 18);
  return buffer;
}

function sqlBatch(sqlText, transactionDescriptor) {
  if (typeof sqlText !== 'string') throw new TypeError('SQL Server SQL batch text must be a string');
  return Buffer.concat([transaction(transactionDescriptor, 1), Buffer.from(sqlText, 'utf16le')]);
}

exports.HEADER_TYPE_TRANSACTION_DESCRIPTOR = HEADER_TYPE_TRANSACTION_DESCRIPTOR;
exports.TRANSACTION_HEADER_LENGTH = TRANSACTION_HEADER_LENGTH;
exports.TOTAL_LENGTH = TOTAL_LENGTH;
exports.transaction = transaction;
exports.sqlBatch = sqlBatch;
