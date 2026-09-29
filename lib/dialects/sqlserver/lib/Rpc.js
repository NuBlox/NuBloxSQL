'use strict';

var AllHeaders = require('./AllHeaders');

var PROC_ID_SP_EXECUTESQL = 10;
var TYPES = Object.freeze({ INTN:0x26, BITN:0x68, FLOATN:0x6d, BIGVARBINARY:0xa5, NVARCHAR:0xe7 });
var DEFAULT_COLLATION = Buffer.from([0x09,0x04,0xd0,0x00,0x34]);

function bVarchar(value) {
  if (typeof value !== 'string') throw new TypeError('SQL Server RPC parameter name must be a string');
  if (value.length > 255) throw new RangeError('SQL Server RPC parameter name is too long');
  return Buffer.concat([Buffer.from([value.length]), Buffer.from(value,'utf16le')]);
}
function nvarcharType(maxChars, collation) {
  if (!Number.isInteger(maxChars) || maxChars < 1 || maxChars > 4000) throw new RangeError('SQL Server NVARCHAR RPC length must be 1..4000 characters');
  var buffer=Buffer.alloc(8);buffer[0]=TYPES.NVARCHAR;buffer.writeUInt16LE(maxChars*2,1);Buffer.from(collation||DEFAULT_COLLATION).copy(buffer,3,0,5);return buffer;
}
function nvarcharValue(value) {
  if (value === null) return Buffer.from([0xff,0xff]);
  var bytes=Buffer.from(String(value),'utf16le');
  if (bytes.length > 8000) throw new RangeError('SQL Server NVARCHAR RPC value exceeds 4000 characters');
  var length=Buffer.alloc(2);length.writeUInt16LE(bytes.length,0);return Buffer.concat([length,bytes]);
}
function intnType(width){return Buffer.from([TYPES.INTN,width]);}
function intnValue(value,width){if(value===null)return Buffer.from([0]);var out=Buffer.alloc(1+width);out[0]=width;if(width===4)out.writeInt32LE(value,1);else out.writeBigInt64LE(typeof value==='bigint'?value:BigInt(value),1);return out;}
function bitnType(){return Buffer.from([TYPES.BITN,1]);}
function bitnValue(value){if(value===null)return Buffer.from([0]);return Buffer.from([1,value?1:0]);}
function floatnType(){return Buffer.from([TYPES.FLOATN,8]);}
function floatnValue(value){if(value===null)return Buffer.from([0]);var out=Buffer.alloc(9);out[0]=8;out.writeDoubleLE(value,1);return out;}
function binaryType(maxBytes){var out=Buffer.alloc(3);out[0]=TYPES.BIGVARBINARY;out.writeUInt16LE(maxBytes,1);return out;}
function binaryValue(value){if(value===null)return Buffer.from([0xff,0xff]);var bytes=Buffer.from(value);if(bytes.length>8000)throw new RangeError('SQL Server VARBINARY RPC value exceeds 8000 bytes');var len=Buffer.alloc(2);len.writeUInt16LE(bytes.length,0);return Buffer.concat([len,bytes]);}

function infer(value) {
  if (value === null) return { definition:'nvarchar(4000)', type:nvarcharType(4000), data:nvarcharValue(null) };
  if (typeof value === 'boolean') return { definition:'bit', type:bitnType(), data:bitnValue(value) };
  if (typeof value === 'bigint') return { definition:'bigint', type:intnType(8), data:intnValue(value,8) };
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('SQL Server RPC number must be finite');
    if (Number.isInteger(value) && value >= -2147483648 && value <= 2147483647) return { definition:'int', type:intnType(4), data:intnValue(value,4) };
    return { definition:'float', type:floatnType(), data:floatnValue(value) };
  }
  if (typeof value === 'string') {
    if (value.length > 4000) throw new RangeError('SQL Server RPC string exceeds 4000 characters; MAX/PLP support is not enabled yet');
    return { definition:'nvarchar(4000)', type:nvarcharType(4000), data:nvarcharValue(value) };
  }
  if (Buffer.isBuffer(value) || ArrayBuffer.isView(value)) {
    var bytes=Buffer.from(value.buffer || value, value.byteOffset || 0, value.byteLength === undefined ? value.length : value.byteLength);
    if (bytes.length > 8000) throw new RangeError('SQL Server RPC binary value exceeds 8000 bytes; MAX/PLP support is not enabled yet');
    return { definition:'varbinary(8000)', type:binaryType(8000), data:binaryValue(bytes) };
  }
  throw new TypeError('Unsupported SQL Server RPC parameter type: '+Object.prototype.toString.call(value));
}

function parameter(name, encoded) {
  return Buffer.concat([bVarchar(name),Buffer.from([0]),encoded.type,encoded.data]);
}
function procHeader(procId) {
  var out=Buffer.alloc(6);out.writeUInt16LE(0xffff,0);out.writeUInt16LE(procId,2);out.writeUInt16LE(0,4);return out;
}
function encodeExecuteSql(sqlText, values, transactionDescriptor) {
  if (typeof sqlText !== 'string' || sqlText.length === 0) throw new TypeError('SQL Server parameterized SQL must be a non-empty string');
  if (sqlText.length > 4000) throw new RangeError('SQL Server parameterized SQL exceeds 4000 characters; NVARCHAR(MAX)/PLP support is not enabled yet');
  if (!Array.isArray(values)) throw new TypeError('SQL Server RPC values must be an array');
  var encodedValues=[],definitions=[];
  for(var i=0;i<values.length;i++){var encoded=infer(values[i]);encodedValues.push(encoded);definitions.push('@p'+(i+1)+' '+encoded.definition);}
  var stmt={type:nvarcharType(4000),data:nvarcharValue(sqlText)};
  var defs={type:nvarcharType(4000),data:nvarcharValue(definitions.join(', '))};
  var parts=[AllHeaders.transaction(transactionDescriptor||0n,1),procHeader(PROC_ID_SP_EXECUTESQL),parameter('@stmt',stmt),parameter('@params',defs)];
  for(var index=0;index<encodedValues.length;index++) parts.push(parameter('@p'+(index+1),encodedValues[index]));
  return Buffer.concat(parts);
}

exports.PROC_ID_SP_EXECUTESQL=PROC_ID_SP_EXECUTESQL;
exports.TYPES=TYPES;
exports.DEFAULT_COLLATION=DEFAULT_COLLATION;
exports.infer=infer;
exports.encodeExecuteSql=encodeExecuteSql;
