'use strict';

var Rpc = require('./Rpc');
var ResultStream = require('./ResultStream');

var TOKENS = ResultStream.TOKENS;
var TYPES = ResultStream.TYPES;
var FLAG_NULLABLE = 0x0001;
var FLAG_UPDATEABLE_READWRITE = 0x0004;
var FLAGS_NULLABLE_UPDATEABLE = FLAG_NULLABLE | FLAG_UPDATEABLE_READWRITE;

function quoteIdentifier(value) {
  if (typeof value !== 'string' || !value.length) throw new TypeError('SQL Server bulk identifier must be non-empty');
  if (value.indexOf('\0') !== -1) throw new TypeError('SQL Server bulk identifier cannot contain NUL bytes');
  return '[' + value.replace(/\]/g, ']]') + ']';
}

function tableSql(parts) {
  if (!Array.isArray(parts) || !parts.length) throw new TypeError('SQL Server bulk table must be non-empty identifier parts');
  return parts.map(quoteIdentifier).join('.');
}

function metadataQuery(tableParts, columnNames) {
  if (!Array.isArray(columnNames) || !columnNames.length) throw new TypeError('SQL Server bulk columns must be a non-empty array');
  return 'SELECT TOP (0) ' + columnNames.map(quoteIdentifier).join(', ') + ' FROM ' + tableSql(tableParts);
}

function bVarchar(value) {
  var encoded = Buffer.from(value, 'utf16le');
  if (value.length > 255) throw new RangeError('SQL Server bulk column name is too long');
  return Buffer.concat([Buffer.from([value.length]), encoded]);
}

function typeInfoFromTarget(column) {
  var type = column.type;
  if ([TYPES.INT1,TYPES.BIT,TYPES.INT2,TYPES.INT4,TYPES.INT8,TYPES.FLT4,TYPES.FLT8,TYPES.MONEY,TYPES.MONEY4,TYPES.DATETIME,TYPES.DATETIME4,TYPES.DATE].indexOf(type) !== -1) {
    return Buffer.from([type]);
  }
  if ([TYPES.INTN,TYPES.BITN,TYPES.FLOATN,TYPES.MONEYN].indexOf(type) !== -1) {
    if (!Number.isInteger(column.maxLength) || column.maxLength < 1 || column.maxLength > 255) return null;
    return Buffer.from([type, column.maxLength]);
  }
  if (type === TYPES.GUID) return Buffer.from([type, 16]);
  if ([TYPES.TIME,TYPES.DATETIME2,TYPES.DATETIMEOFFSET].indexOf(type) !== -1) {
    if (!Number.isInteger(column.scale) || column.scale < 0 || column.scale > 7) return null;
    return Buffer.from([type, column.scale]);
  }
  if ([TYPES.DECIMAL,TYPES.NUMERIC,TYPES.DECIMALN,TYPES.NUMERICN].indexOf(type) !== -1) {
    var parts=[Buffer.from([type])];
    if (type===TYPES.DECIMALN||type===TYPES.NUMERICN) parts.push(Buffer.from([column.maxLength]));
    parts.push(Buffer.from([column.precision,column.scale]));
    return Buffer.concat(parts);
  }
  if ([TYPES.NVARCHAR,TYPES.NCHAR,TYPES.BIGVARCHAR,TYPES.BIGCHAR].indexOf(type) !== -1) {
    if (!Number.isInteger(column.maxLength) || !Buffer.isBuffer(column.collation) || column.collation.length !== 5) return null;
    var charInfo=Buffer.alloc(8);
    charInfo[0]=type;
    charInfo.writeUInt16LE(column.maxLength,1);
    column.collation.copy(charInfo,3);
    return charInfo;
  }
  if ([TYPES.BIGVARBINARY,TYPES.BIGBINARY].indexOf(type) !== -1) {
    if (!Number.isInteger(column.maxLength)) return null;
    var binaryInfo=Buffer.alloc(3);
    binaryInfo[0]=type;
    binaryInfo.writeUInt16LE(column.maxLength,1);
    return binaryInfo;
  }
  return null;
}

function declaration(column) {
  var type=column.type;
  if (type===TYPES.INT1) return 'tinyint';
  if (type===TYPES.INT2) return 'smallint';
  if (type===TYPES.INT4 || (type===TYPES.INTN && column.maxLength===4)) return 'int';
  if (type===TYPES.INT8 || (type===TYPES.INTN && column.maxLength===8)) return 'bigint';
  if (type===TYPES.BIT || type===TYPES.BITN) return 'bit';
  if (type===TYPES.FLT4) return 'real';
  if (type===TYPES.FLT8 || type===TYPES.FLOATN) return 'float';
  if (type===TYPES.GUID) return 'uniqueidentifier';
  if (type===TYPES.DATE) return 'date';
  if (type===TYPES.TIME) return 'time(' + column.scale + ')';
  if (type===TYPES.DATETIME2) return 'datetime2(' + column.scale + ')';
  if (type===TYPES.DATETIMEOFFSET) return 'datetimeoffset(' + column.scale + ')';
  if (type===TYPES.DECIMAL || type===TYPES.DECIMALN) return 'decimal(' + column.precision + ',' + column.scale + ')';
  if (type===TYPES.NUMERIC || type===TYPES.NUMERICN) return 'numeric(' + column.precision + ',' + column.scale + ')';
  if (type===TYPES.NVARCHAR) return column.maxLength===0xffff?'nvarchar(max)':'nvarchar(' + Math.floor(column.maxLength/2) + ')';
  if (type===TYPES.NCHAR) return 'nchar(' + Math.floor(column.maxLength/2) + ')';
  if (type===TYPES.BIGVARBINARY) return column.maxLength===0xffff?'varbinary(max)':'varbinary(' + column.maxLength + ')';
  if (type===TYPES.BIGBINARY) return 'binary(' + column.maxLength + ')';
  return null;
}

function metadataColumn(column, name) {
  var info=typeInfoFromTarget(column);
  if (!info) return null;
  var header=Buffer.alloc(6);
  header.writeUInt32LE(column.userType || 0,0);
  header.writeUInt16LE((column.flags || 0) | FLAG_UPDATEABLE_READWRITE,4);
  return Buffer.concat([header,info,bVarchar(name)]);
}

function colMetadata(columns) {
  var count=Buffer.alloc(2);
  count.writeUInt16LE(columns.length,0);
  var parts=[Buffer.from([TOKENS.COLMETADATA]),count];
  for(var i=0;i<columns.length;i++){
    var encoded=metadataColumn(columns[i].metadata,columns[i].name);
    if(!encoded)return null;
    parts.push(encoded);
  }
  return Buffer.concat(parts);
}

function done() {
  var out=Buffer.alloc(13);
  out[0]=TOKENS.DONE;
  return out;
}

function variableLength(value, width, writer) {
  if (value === null || value === undefined) return Buffer.from([0]);
  var out=Buffer.alloc(1+width);
  out[0]=width;
  writer(out,1,value);
  return out;
}

function fixedWidth(value,width,writer){
  if(value===null||value===undefined)return null;
  var out=Buffer.alloc(width);
  writer(out,0,value);
  return out;
}

function encodeValue(column,value){
  var type=column.type;
  if(type===TYPES.INT1)return fixedWidth(value,1,function(out,o,v){out[o]=v;});
  if(type===TYPES.INT2)return fixedWidth(value,2,function(out,o,v){out.writeInt16LE(v,o);});
  if(type===TYPES.INT4)return fixedWidth(value,4,function(out,o,v){out.writeInt32LE(v,o);});
  if(type===TYPES.INT8)return fixedWidth(value,8,function(out,o,v){out.writeBigInt64LE(typeof v==='bigint'?v:BigInt(v),o);});
  if(type===TYPES.BIT)return fixedWidth(value,1,function(out,o,v){out[o]=v?1:0;});
  if(type===TYPES.FLT4)return fixedWidth(value,4,function(out,o,v){out.writeFloatLE(v,o);});
  if(type===TYPES.FLT8)return fixedWidth(value,8,function(out,o,v){out.writeDoubleLE(v,o);});
  if(type===TYPES.INTN){
    return variableLength(value,column.maxLength,function(out,o,v){
      if(column.maxLength===1)out[o]=v;
      else if(column.maxLength===2)out.writeInt16LE(v,o);
      else if(column.maxLength===4)out.writeInt32LE(v,o);
      else if(column.maxLength===8)out.writeBigInt64LE(typeof v==='bigint'?v:BigInt(v),o);
      else throw new RangeError('Unsupported SQL Server bulk INTN width');
    });
  }
  if(type===TYPES.BITN)return variableLength(value,1,function(out,o,v){out[o]=v?1:0;});
  if(type===TYPES.FLOATN)return variableLength(value,column.maxLength,function(out,o,v){if(column.maxLength===4)out.writeFloatLE(v,o);else if(column.maxLength===8)out.writeDoubleLE(v,o);else throw new RangeError('Unsupported SQL Server bulk FLOATN width');});
  if(type===TYPES.NVARCHAR||type===TYPES.NCHAR){
    if(value===null||value===undefined)return column.maxLength===0xffff?Rpc.plpValue(null):Buffer.from([0xff,0xff]);
    if(typeof value!=='string')return null;
    var bytes=Buffer.from(value,'utf16le');
    if(column.maxLength===0xffff)return Rpc.plpValue(bytes);
    if(bytes.length>column.maxLength)return null;
    var len=Buffer.alloc(2);len.writeUInt16LE(bytes.length,0);return Buffer.concat([len,bytes]);
  }
  if(type===TYPES.BIGVARBINARY||type===TYPES.BIGBINARY){
    if(value===null||value===undefined)return column.maxLength===0xffff?Rpc.plpValue(null):Buffer.from([0xff,0xff]);
    if(!Buffer.isBuffer(value)&&!ArrayBuffer.isView(value))return null;
    var raw=Buffer.from(value.buffer||value,value.byteOffset||0,value.byteLength===undefined?value.length:value.byteLength);
    if(column.maxLength===0xffff)return Rpc.plpValue(raw);
    if(raw.length>column.maxLength)return null;
    var blen=Buffer.alloc(2);blen.writeUInt16LE(raw.length,0);return Buffer.concat([blen,raw]);
  }
  return null;
}

function normalizeTargetMetadata(columnNames,targetColumns){
  if(!Array.isArray(targetColumns)||targetColumns.length!==columnNames.length)return null;
  var byName=Object.create(null);
  targetColumns.forEach(function(column){byName[column.name]=column;});
  return columnNames.map(function(name){
    var metadata=byName[name];
    if(!metadata)return null;
    var sqlType=declaration(metadata);
    if(!sqlType||!typeInfoFromTarget(metadata))return null;
    return {name:name,metadata:metadata,sqlType:sqlType};
  });
}

function build(tableParts,columnNames,rows,targetColumns){
  if(!Array.isArray(columnNames)||!columnNames.length)throw new TypeError('SQL Server bulk columns must be a non-empty array');
  if(!Array.isArray(rows)||!rows.length)throw new TypeError('SQL Server bulk rows must be a non-empty array');
  var columns=normalizeTargetMetadata(columnNames,targetColumns);
  if(!columns||columns.some(function(column){return !column;}))return null;

  var statement='INSERT BULK '+tableSql(tableParts)+' ('+columns.map(function(column){return quoteIdentifier(column.name)+' '+column.sqlType;}).join(', ')+')';
  var metadata=colMetadata(columns);
  if(!metadata)return null;
  var payloadParts=[metadata];

  for(var r=0;r<rows.length;r++){
    var rowParts=[Buffer.from([TOKENS.ROW])];
    for(var c=0;c<columns.length;c++){
      var encoded=encodeValue(columns[c].metadata,rows[r][columns[c].name]);
      if(encoded===null)return null;
      rowParts.push(encoded);
    }
    payloadParts.push(Buffer.concat(rowParts));
  }
  payloadParts.push(done());

  return Object.freeze({
    statement:statement,
    payload:Buffer.concat(payloadParts),
    columns:Object.freeze(columns.map(function(column){return Object.freeze({name:column.name,sqlType:column.sqlType});})),
    rowCount:rows.length
  });
}

exports.FLAG_NULLABLE=FLAG_NULLABLE;
exports.FLAG_UPDATEABLE_READWRITE=FLAG_UPDATEABLE_READWRITE;
exports.FLAGS_NULLABLE_UPDATEABLE=FLAGS_NULLABLE_UPDATEABLE;
exports.quoteIdentifier=quoteIdentifier;
exports.metadataQuery=metadataQuery;
exports.typeInfoFromTarget=typeInfoFromTarget;
exports.declaration=declaration;
exports.encodeValue=encodeValue;
exports.build=build;
