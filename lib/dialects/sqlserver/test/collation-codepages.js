'use strict';

var assert=require('assert');
var Collation=require('../lib/Collation');
var ResultStream=require('../lib/ResultStream');

function tdsCollation(lcid,flags,version,sortId){
  var b=Buffer.alloc(5);
  var info=((lcid&0xfffff)|((flags&0xff)<<20)|((version&0x0f)<<28))>>>0;
  b.writeUInt32LE(info,0);b[4]=sortId||0;return b;
}
function sqlCollation52(){return Buffer.from([0x09,0x04,0xd0,0x00,0x34]);}
function character(type,max,collation){var b=Buffer.alloc(8);b[0]=type;b.writeUInt16LE(max,1);Buffer.from(collation).copy(b,3);return b;}
function column(typeInfo,name){var head=Buffer.alloc(6);head.writeUInt32LE(0,0);head.writeUInt16LE(1,4);return Buffer.concat([head,typeInfo,Buffer.from([name.length]),Buffer.from(name,'utf16le')]);}
function metadata(columns){var count=Buffer.alloc(2);count.writeUInt16LE(columns.length,0);return Buffer.concat([Buffer.from([ResultStream.TOKENS.COLMETADATA]),count].concat(columns));}
function value(bytes){var len=Buffer.alloc(2);len.writeUInt16LE(bytes.length,0);return Buffer.concat([len,bytes]);}
function plp(bytes){var total=Buffer.alloc(8);total.writeBigUInt64LE(BigInt(bytes.length));var len=Buffer.alloc(4);len.writeUInt32LE(bytes.length);return Buffer.concat([total,len,bytes,Buffer.alloc(4)]);}
function done(rows){var b=Buffer.alloc(13);b[0]=ResultStream.TOKENS.DONE;b.writeUInt16LE(0x0010,1);b.writeBigUInt64LE(BigInt(rows),5);return b;}

var cp1=Collation.parse(sqlCollation52());
assert.strictEqual(cp1.lcid,1033);
assert.strictEqual(cp1.sortId,52);
assert.strictEqual(cp1.codePage,1252);
assert.strictEqual(cp1.encoding,'windows-1252');

var cp1252=tdsCollation(1033,0,2,0);
var cp1251=tdsCollation(1049,0,2,0);
var utf8=tdsCollation(1033,0x40,2,0);
assert.strictEqual(Collation.parse(cp1252).codePage,1252);
assert.strictEqual(Collation.parse(cp1251).codePage,1251);
assert.strictEqual(Collation.parse(utf8).codePage,65001);
assert.strictEqual(Collation.parse(utf8).utf8,true);
assert.strictEqual(Collation.decode(cp1252,Buffer.from([0x4e,0x75,0x42,0x6c,0x6f,0x78,0x20,0x80,0x20,0x63,0x61,0x66,0xe9])),'NuBlox € café');
assert.strictEqual(Collation.decode(cp1251,Buffer.from([0xcf,0xf0,0xe8,0xe2,0xe5,0xf2])),'Привет');
assert.strictEqual(Collation.decode(utf8,Buffer.from('NuBlox Ω 🚀','utf8')),'NuBlox Ω 🚀');
assert.throws(function(){Collation.decode(tdsCollation(1033,0,0,99),Buffer.from('x'));},/Unsupported SQL Server COLLATION code page/);
assert.throws(function(){Collation.decode(Buffer.alloc(5),Buffer.from('x'));},/raw COLLATION/);

var cpBytes=Buffer.from([0x4e,0x75,0x42,0x6c,0x6f,0x78,0x20,0x80,0x20,0x63,0x61,0x66,0xe9]);
var ruBytes=Buffer.from([0xcf,0xf0,0xe8,0xe2,0xe5,0xf2]);
var utfBytes=Buffer.from('NuBlox Ω 🚀','utf8');
var maxBytes=Buffer.concat(Array.from({length:600},function(){return cpBytes;}));
var payload=Buffer.concat([
  metadata([
    column(character(ResultStream.TYPES.BIGVARCHAR,100,cp1252),'western'),
    column(character(ResultStream.TYPES.BIGVARCHAR,100,cp1251),'cyrillic'),
    column(character(ResultStream.TYPES.BIGVARCHAR,100,utf8),'utf8_value'),
    column(character(ResultStream.TYPES.BIGVARCHAR,0xffff,cp1252),'western_max')
  ]),
  Buffer.from([ResultStream.TOKENS.ROW]),value(cpBytes),value(ruBytes),value(utfBytes),plp(maxBytes),done(1)
]);
var result=ResultStream.parse(payload);
assert.strictEqual(result.rows[0].western,'NuBlox € café');
assert.strictEqual(result.rows[0].cyrillic,'Привет');
assert.strictEqual(result.rows[0].utf8_value,'NuBlox Ω 🚀');
assert.strictEqual(result.rows[0].western_max,'NuBlox € café'.repeat(600));
assert.strictEqual(result.columns[0].collationInfo.codePage,1252);
assert.strictEqual(result.columns[1].collationInfo.codePage,1251);
assert.strictEqual(result.columns[2].collationInfo.codePage,65001);
assert.deepStrictEqual(result.columns[0].collation,cp1252);

console.log('NuBloxSQL SQL Server collation/code-page contract passed');
