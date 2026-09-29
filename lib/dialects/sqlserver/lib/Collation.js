'use strict';

var UTF8_FLAG = 0x04000000;
var FLAG_MASKS = Object.freeze({
  ignoreCase: 0x00100000,
  ignoreAccent: 0x00200000,
  ignoreKana: 0x00400000,
  ignoreWidth: 0x00800000,
  binary: 0x01000000,
  binary2: 0x02000000,
  utf8: UTF8_FLAG
});

var SQL_SORT_CODEPAGES = Object.freeze({
  50: 1252,
  52: 1252,
  80: 1250
});

var LCID_CODEPAGES = Object.freeze({
  1025:1256,1026:1251,1028:950,1029:1250,1030:1252,1031:1252,1032:1253,
  1033:1252,1034:1252,1035:1252,1036:1252,1037:1255,1038:1250,1039:1252,
  1040:1252,1041:932,1042:949,1043:1252,1044:1252,1045:1250,1046:1252,
  1048:1250,1049:1251,1050:1250,1051:1250,1052:1250,1053:1252,1054:874,
  1055:1254,1057:1252,1058:1251,1059:1251,1060:1250,1061:1257,1062:1257,
  1063:1257,1065:1256,1066:1258,1068:1254,1071:1251,2052:936,2057:1252,
  2060:1252,2064:1252,2067:1252,2068:1252,2070:1252,2074:1250,3076:950,
  3079:1252,3081:1252,3082:1252,3084:1252,3098:1251,4105:1252,4108:1252,
  5129:1252,5132:1252,6153:1252,6156:1252,7177:1252,7180:1252,8201:1252,
  8204:1252,9225:1252,9228:1252,10249:1252,10252:1252,11273:1252,
  11276:1252,12297:1252,12300:1252,13321:1252,13324:1252,14345:1252,
  14348:1252,15369:1252,16393:1252,17417:1252,18441:1252,19465:1252,
  20489:1252,21513:1252,22537:1252,23561:1252,24585:1252,25609:1252,
  26633:1252,27657:1252,28681:1252,29705:1252,30729:1252,31753:1252
});

var DECODER_LABELS = Object.freeze({
  874:'windows-874',
  932:'shift_jis',
  936:'gbk',
  949:'euc-kr',
  950:'big5',
  1250:'windows-1250',
  1251:'windows-1251',
  1252:'windows-1252',
  1253:'windows-1253',
  1254:'windows-1254',
  1255:'windows-1255',
  1256:'windows-1256',
  1257:'windows-1257',
  1258:'windows-1258',
  65001:'utf-8'
});

function requireCollation(value) {
  var buffer = Buffer.from(value || []);
  if (buffer.length !== 5) throw new RangeError('SQL Server COLLATION must contain exactly 5 bytes');
  return buffer;
}

function parse(value) {
  var buffer = requireCollation(value);
  var info = buffer.readUInt32LE(0);
  var lcid = info & 0x000fffff;
  var sortId = buffer[4];
  var raw = info === 0 && sortId === 0;
  var utf8 = (info & UTF8_FLAG) !== 0;
  var codePage = null;
  if (utf8) codePage = 65001;
  else if (sortId !== 0) codePage = SQL_SORT_CODEPAGES[sortId] || null;
  else if (!raw) codePage = LCID_CODEPAGES[lcid] || null;
  var encoding = codePage === null ? null : (DECODER_LABELS[codePage] || null);
  return Object.freeze({
    raw: raw,
    bytes: Buffer.from(buffer),
    lcid: lcid,
    sortId: sortId,
    version: (info >>> 28) & 0x0f,
    ignoreCase: (info & FLAG_MASKS.ignoreCase) !== 0,
    ignoreAccent: (info & FLAG_MASKS.ignoreAccent) !== 0,
    ignoreKana: (info & FLAG_MASKS.ignoreKana) !== 0,
    ignoreWidth: (info & FLAG_MASKS.ignoreWidth) !== 0,
    binary: (info & FLAG_MASKS.binary) !== 0,
    binary2: (info & FLAG_MASKS.binary2) !== 0,
    utf8: utf8,
    codePage: codePage,
    encoding: encoding
  });
}

function decoderFor(value) {
  var collation = value && value.bytes ? value : parse(value);
  if (collation.raw) throw new RangeError('SQL Server raw COLLATION does not identify a character encoding');
  if (!collation.codePage) {
    throw new RangeError('Unsupported SQL Server COLLATION code page (LCID '+collation.lcid+', SortId '+collation.sortId+')');
  }
  if (!collation.encoding) throw new RangeError('SQL Server code page '+collation.codePage+' is not supported by this NuBloxSQL runtime');
  try {
    return new TextDecoder(collation.encoding, { fatal:true });
  } catch (error) {
    throw new RangeError('SQL Server code page '+collation.codePage+' cannot be decoded by this Node.js runtime');
  }
}

function decode(value, bytes) {
  var collation = value && value.bytes ? value : parse(value);
  return decoderFor(collation).decode(Buffer.from(bytes || []));
}

exports.UTF8_FLAG = UTF8_FLAG;
exports.SQL_SORT_CODEPAGES = SQL_SORT_CODEPAGES;
exports.LCID_CODEPAGES = LCID_CODEPAGES;
exports.parse = parse;
exports.decoderFor = decoderFor;
exports.decode = decode;
