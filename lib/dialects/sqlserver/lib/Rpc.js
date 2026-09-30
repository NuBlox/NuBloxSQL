'use strict';

var typedValues = require('../../../core/TypedValue');
var AllHeaders = require('./AllHeaders');
var Plp = require('./Plp');

var PROC_ID_SP_EXECUTESQL = 10;
var PROC_ID_SP_PREPARE = 11;
var PROC_ID_SP_EXECUTE = 12;
var PROC_ID_SP_UNPREPARE = 15;
var TYPES = Object.freeze({ GUID:0x24, INTN:0x26, BITN:0x68, DECIMALN:0x6a, FLOATN:0x6d, BIGVARBINARY:0xa5, NVARCHAR:0xe7 });
var DEFAULT_COLLATION = Buffer.from([0x09,0x04,0xd0,0x00,0x34]);
var PLP_MAX_LENGTH = 0xffff;
var PLP_CHUNK_SIZE = 64 * 1024;

function bVarchar(value) {
  if (typeof value !== 'string') throw new TypeError('SQL Server RPC parameter name must be a string');
  if (value.length > 255) throw new RangeError('SQL Server RPC parameter name is too long');
  return Buffer.concat([Buffer.from([value.length]), Buffer.from(value,'utf16le')]);
}
function nvarcharType(maxChars, collation) {
  if (!Number.isInteger(maxChars) || maxChars < 1 || maxChars > 4000) throw new RangeError('SQL Server NVARCHAR RPC length must be 1..4000 characters');
  var buffer=Buffer.alloc(8);buffer[0]=TYPES.NVARCHAR;buffer.writeUInt16LE(maxChars*2,1);Buffer.from(collation||DEFAULT_COLLATION).copy(buffer,3,0,5);return buffer;
}
function nvarcharMaxType(collation) {
  var buffer=Buffer.alloc(8);buffer[0]=TYPES.NVARCHAR;buffer.writeUInt16LE(PLP_MAX_LENGTH,1);Buffer.from(collation||DEFAULT_COLLATION).copy(buffer,3,0,5);return buffer;
}
function nvarcharValue(value) {
  if (value === null) return Buffer.from([0xff,0xff]);
  var bytes=Buffer.from(String(value),'utf16le');
  if (bytes.length > 8000) throw new RangeError('SQL Server NVARCHAR RPC value exceeds 4000 characters');
  var length=Buffer.alloc(2);length.writeUInt16LE(bytes.length,0);return Buffer.concat([length,bytes]);
}
function plpValue(value) {
  var marker=Buffer.alloc(8);
  if (value === null) {
    marker.writeBigUInt64LE(Plp.PLP_NULL,0);
    return marker;
  }
  var bytes=Buffer.from(value);
  marker.writeBigUInt64LE(Plp.PLP_UNKNOWN,0);
  if (bytes.length === 0) return Buffer.concat([marker,Buffer.alloc(4)]);
  var parts=[marker];
  for(var offset=0;offset<bytes.length;offset+=PLP_CHUNK_SIZE){
    var chunk=bytes.subarray(offset,Math.min(offset+PLP_CHUNK_SIZE,bytes.length));
    var length=Buffer.alloc(4);length.writeUInt32LE(chunk.length,0);parts.push(length,chunk);
  }
  parts.push(Buffer.alloc(4));
  return Buffer.concat(parts);
}
function nvarcharMaxValue(value) { return value === null ? plpValue(null) : plpValue(Buffer.from(String(value),'utf16le')); }
function intnType(width){return Buffer.from([TYPES.INTN,width]);}
function intnValue(value,width){if(value===null)return Buffer.from([0]);var out=Buffer.alloc(1+width);out[0]=width;if(width===4)out.writeInt32LE(value,1);else out.writeBigInt64LE(typeof value==='bigint'?value:BigInt(value),1);return out;}
function bitnType(){return Buffer.from([TYPES.BITN,1]);}
function bitnValue(value){if(value===null)return Buffer.from([0]);return Buffer.from([1,value?1:0]);}
function floatnType(){return Buffer.from([TYPES.FLOATN,8]);}
function floatnValue(value){if(value===null)return Buffer.from([0]);var out=Buffer.alloc(9);out[0]=8;out.writeDoubleLE(value,1);return out;}
function binaryType(maxBytes){var out=Buffer.alloc(3);out[0]=TYPES.BIGVARBINARY;out.writeUInt16LE(maxBytes,1);return out;}
function binaryMaxType(){var out=Buffer.alloc(3);out[0]=TYPES.BIGVARBINARY;out.writeUInt16LE(PLP_MAX_LENGTH,1);return out;}
function binaryValue(value){if(value===null)return Buffer.from([0xff,0xff]);var bytes=Buffer.from(value);if(bytes.length>8000)throw new RangeError('SQL Server VARBINARY RPC value exceeds 8000 bytes');var len=Buffer.alloc(2);len.writeUInt16LE(bytes.length,0);return Buffer.concat([len,bytes]);}
function binaryMaxValue(value){return value===null?plpValue(null):plpValue(Buffer.from(value));}
function encodeNvarchar(value) {
  if (value === null) return { definition:'nvarchar(4000)', type:nvarcharType(4000), data:nvarcharValue(null) };
  var bytes=Buffer.from(String(value),'utf16le');
  if (bytes.length <= 8000) return { definition:'nvarchar(4000)', type:nvarcharType(4000), data:(function(){var length=Buffer.alloc(2);length.writeUInt16LE(bytes.length,0);return Buffer.concat([length,bytes]);})() };
  return { definition:'nvarchar(max)', type:nvarcharMaxType(), data:plpValue(bytes) };
}
function encodeBinary(value) {
  var bytes=Buffer.from(value.buffer || value, value.byteOffset || 0, value.byteLength === undefined ? value.length : value.byteLength);
  if (bytes.length <= 8000) return { definition:'varbinary(8000)', type:binaryType(8000), data:binaryValue(bytes) };
  return { definition:'varbinary(max)', type:binaryMaxType(), data:binaryMaxValue(bytes) };
}

function decimalStorageLength(precision) {
  if (precision <= 9) return 5;
  if (precision <= 19) return 9;
  if (precision <= 28) return 13;
  return 17;
}
function writeUnsignedBigIntLE(buffer, offset, length, value) {
  for (var i=0;i<length;i++) { buffer[offset+i]=Number(value&0xffn);value>>=8n; }
  if (value !== 0n) throw new RangeError('SQL Server decimal magnitude exceeds declared precision');
}
function decimalType(spec) {
  var length=decimalStorageLength(spec.precision),out=Buffer.alloc(4);out[0]=TYPES.DECIMALN;out[1]=length;out[2]=spec.precision;out[3]=spec.scale;return out;
}
function decimalValue(value,spec) {
  if (value===null) return Buffer.from([0]);
  var negative=value[0]==='-',digits=negative?value.slice(1):value;
  digits=digits.replace('.','');
  var magnitude=BigInt(digits||'0'),length=decimalStorageLength(spec.precision),out=Buffer.alloc(1+length);
  out[0]=length;out[1]=negative?0:1;writeUnsignedBigIntLE(out,2,length-1,magnitude);return out;
}
function guidType(){return Buffer.from([TYPES.GUID,16]);}
function guidValue(value){
  if(value===null)return Buffer.from([0]);
  var parts=value.split('-'),raw=Buffer.alloc(17);raw[0]=16;
  raw.writeUInt32LE(parseInt(parts[0],16),1);raw.writeUInt16LE(parseInt(parts[1],16),5);raw.writeUInt16LE(parseInt(parts[2],16),7);
  Buffer.from(parts[3]+parts[4],'hex').copy(raw,9);return raw;
}
function encodeTyped(value){
  var spec=value.spec,nativeValue=value.value;
  if(spec.type==='decimal')return{definition:'decimal('+spec.precision+','+spec.scale+')',type:decimalType(spec),data:decimalValue(nativeValue,spec)};
  if(spec.type==='uuid')return{definition:'uniqueidentifier',type:guidType(),data:guidValue(nativeValue)};
  throw new TypeError('Unsupported SQL Server portable typed parameter: '+spec.type);
}

function infer(value) {
  if (typedValues.isTypedValue(value)) return encodeTyped(value);
  if (value === null) return { definition:'nvarchar(4000)', type:nvarcharType(4000), data:nvarcharValue(null) };
  if (typeof value === 'boolean') return { definition:'bit', type:bitnType(), data:bitnValue(value) };
  if (typeof value === 'bigint') return { definition:'bigint', type:intnType(8), data:intnValue(value,8) };
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('SQL Server RPC number must be finite');
    if (Number.isInteger(value) && value >= -2147483648 && value <= 2147483647) return { definition:'int', type:intnType(4), data:intnValue(value,4) };
    return { definition:'float', type:floatnType(), data:floatnValue(value) };
  }
  if (typeof value === 'string') return encodeNvarchar(value);
  if (Buffer.isBuffer(value) || ArrayBuffer.isView(value)) return encodeBinary(value);
  throw new TypeError('Unsupported SQL Server RPC parameter type: '+Object.prototype.toString.call(value));
}
function parameter(name, encoded) { return Buffer.concat([bVarchar(name),Buffer.from([0]),encoded.type,encoded.data]); }
function procHeader(procId) { var out=Buffer.alloc(6);out.writeUInt16LE(0xffff,0);out.writeUInt16LE(procId,2);out.writeUInt16LE(0,4);return out; }
function definitions(values) { var parts=[];for(var i=0;i<values.length;i++)parts.push('@p'+(i+1)+' '+infer(values[i]).definition);return parts.join(', '); }
function encodeExecuteSql(sqlText, values, transactionDescriptor) {
  if (typeof sqlText !== 'string' || sqlText.length === 0) throw new TypeError('SQL Server parameterized SQL must be a non-empty string');
  if (!Array.isArray(values)) throw new TypeError('SQL Server RPC values must be an array');
  var encodedValues=[],defs=[];
  for(var i=0;i<values.length;i++){var encoded=infer(values[i]);encodedValues.push(encoded);defs.push('@p'+(i+1)+' '+encoded.definition);}
  var stmt=encodeNvarchar(sqlText);
  var declaration=encodeNvarchar(defs.join(', '));
  var parts=[AllHeaders.transaction(transactionDescriptor||0n,1),procHeader(PROC_ID_SP_EXECUTESQL),parameter('@stmt',stmt),parameter('@params',declaration)];
  for(var index=0;index<encodedValues.length;index++) parts.push(parameter('@p'+(index+1),encodedValues[index]));
  return Buffer.concat(parts);
}
function encodeExecutePrepared(handle, values, transactionDescriptor) {
  if (!Number.isInteger(handle) || handle <= 0) throw new RangeError('SQL Server prepared statement handle must be a positive integer');
  if (!Array.isArray(values)) throw new TypeError('SQL Server prepared values must be an array');
  var parts=[AllHeaders.transaction(transactionDescriptor||0n,1),procHeader(PROC_ID_SP_EXECUTE),parameter('',infer(handle))];
  for(var i=0;i<values.length;i++)parts.push(parameter('',infer(values[i])));
  return Buffer.concat(parts);
}
function encodeUnprepare(handle, transactionDescriptor) {
  if (!Number.isInteger(handle) || handle <= 0) throw new RangeError('SQL Server prepared statement handle must be a positive integer');
  return Buffer.concat([AllHeaders.transaction(transactionDescriptor||0n,1),procHeader(PROC_ID_SP_UNPREPARE),parameter('',infer(handle))]);
}

exports.PROC_ID_SP_EXECUTESQL=PROC_ID_SP_EXECUTESQL;
exports.PROC_ID_SP_PREPARE=PROC_ID_SP_PREPARE;
exports.PROC_ID_SP_EXECUTE=PROC_ID_SP_EXECUTE;
exports.PROC_ID_SP_UNPREPARE=PROC_ID_SP_UNPREPARE;
exports.TYPES=TYPES;
exports.DEFAULT_COLLATION=DEFAULT_COLLATION;
exports.PLP_MAX_LENGTH=PLP_MAX_LENGTH;
exports.PLP_CHUNK_SIZE=PLP_CHUNK_SIZE;
exports.plpValue=plpValue;
exports.nvarcharMaxType=nvarcharMaxType;
exports.binaryMaxType=binaryMaxType;
exports.decimalStorageLength=decimalStorageLength;
exports.decimalType=decimalType;
exports.decimalValue=decimalValue;
exports.guidType=guidType;
exports.guidValue=guidValue;
exports.infer=infer;
exports.definitions=definitions;
exports.encodeExecuteSql=encodeExecuteSql;
exports.encodeExecutePrepared=encodeExecutePrepared;
exports.encodeUnprepare=encodeUnprepare;
