'use strict';

var assert=require('assert');
var ResultStream=require('../lib/ResultStream');
var Variant=require('../lib/Variant');
var IncrementalResultStream=require('../lib/IncrementalResultStream').IncrementalResultStream;

var CP1252=Buffer.from([0x09,0x04,0xd0,0x00,0x34]);
function u32(value){var b=Buffer.alloc(4);b.writeUInt32LE(value,0);return b;}
function variant(baseType,props,data){props=Buffer.from(props||[]);data=Buffer.from(data||[]);var body=Buffer.concat([Buffer.from([baseType,props.length]),props,data]);return Buffer.concat([u32(body.length),body]);}
function nullVariant(){return Buffer.alloc(4);}
function typeInfo(maxLength){var b=Buffer.alloc(5);b[0]=ResultStream.TYPES.SSVARIANT;b.writeUInt32LE(maxLength||8016,1);return b;}
function column(name){var head=Buffer.alloc(6);head.writeUInt32LE(0,0);head.writeUInt16LE(1,4);return Buffer.concat([head,typeInfo(),Buffer.from([name.length]),Buffer.from(name,'utf16le')]);}
function metadata(names){var count=Buffer.alloc(2);count.writeUInt16LE(names.length,0);return Buffer.concat([Buffer.from([ResultStream.TOKENS.COLMETADATA]),count].concat(names.map(column)));}
function done(rows){var b=Buffer.alloc(13);b[0]=ResultStream.TOKENS.DONE;b.writeUInt16LE(0x0010,1);b.writeBigUInt64LE(BigInt(rows),5);return b;}
function bigint(value){var b=Buffer.alloc(8);b.writeBigInt64LE(BigInt(value),0);return b;}
function int4(value){var b=Buffer.alloc(4);b.writeInt32LE(value,0);return b;}
function decimal(value,precision,scale){var magnitude=BigInt(String(value).replace('-','').replace('.',''));var length=precision<=9?5:(precision<=19?9:(precision<=28?13:17));var b=Buffer.alloc(length);b[0]=String(value)[0]==='-'?0:1;for(var i=1;i<length;i++){b[i]=Number(magnitude&255n);magnitude>>=8n;}return b;}
function guidBytes(){return Buffer.from([0x33,0x22,0x11,0x00,0x55,0x44,0x77,0x66,0x88,0x99,0xaa,0xbb,0xcc,0xdd,0xee,0xff]);}
function dateBytes(year,month,day){var ms=Date.UTC(year,month-1,day)-Date.UTC(1,0,1);var days=Math.round(ms/86400000);var b=Buffer.alloc(3);b[0]=days&255;b[1]=(days>>>8)&255;b[2]=(days>>>16)&255;return b;}
function charProps(collation,maxLength){var b=Buffer.alloc(7);Buffer.from(collation).copy(b,0);b.writeUInt16LE(maxLength,5);return b;}
function binaryProps(maxLength){var b=Buffer.alloc(2);b.writeUInt16LE(maxLength,0);return b;}

var names=['int_value','bigint_value','decimal_value','guid_value','date_value','unicode_value','varchar_value','binary_value','null_value'];
var unicode=Buffer.from('NuBlox Ω','utf16le');
var western=Buffer.from([0x4e,0x75,0x42,0x6c,0x6f,0x78,0x20,0x80,0x20,0x63,0x61,0x66,0xe9]);
var binary=Buffer.from([0x00,0x11,0x22,0xaa,0xbb]);
var row=Buffer.concat([
  Buffer.from([ResultStream.TOKENS.ROW]),
  variant(Variant.TYPES.INT4,[],int4(42)),
  variant(Variant.TYPES.INT8,[],bigint(9223372036854775807n)),
  variant(Variant.TYPES.DECIMALN,Buffer.from([14,4]),decimal('1234567890.1234',14,4)),
  variant(Variant.TYPES.GUID,[],guidBytes()),
  variant(Variant.TYPES.DATE,[],dateBytes(2026,9,29)),
  variant(Variant.TYPES.NVARCHAR,charProps(CP1252,unicode.length),unicode),
  variant(Variant.TYPES.BIGVARCHAR,charProps(CP1252,100),western),
  variant(Variant.TYPES.BIGVARBINARY,binaryProps(20),binary),
  nullVariant()
]);
var payload=Buffer.concat([metadata(names),row,done(1)]);
var parsed=ResultStream.parse(payload);
assert.strictEqual(parsed.columns.length,names.length);
assert.strictEqual(parsed.columns[0].type,ResultStream.TYPES.SSVARIANT);
assert.strictEqual(parsed.columns[0].maxLength,8016);
assert.deepStrictEqual(parsed.rows,[{
  int_value:42,
  bigint_value:9223372036854775807n,
  decimal_value:'1234567890.1234',
  guid_value:'00112233-4455-6677-8899-aabbccddeeff',
  date_value:'2026-09-29',
  unicode_value:'NuBlox Ω',
  varchar_value:'NuBlox € café',
  binary_value:binary,
  null_value:null
}]);

var incremental=new IncrementalResultStream(),rows=[];
for(var offset=0;offset<payload.length;offset+=7){var end=Math.min(payload.length,offset+7);rows=rows.concat(Array.from(incremental.push(payload.subarray(offset,end),end===payload.length)));}
assert.deepStrictEqual(rows,parsed.rows);
assert.strictEqual(incremental.result().success,true);

assert.throws(function(){Variant.decodeInstance(Buffer.from([0xff,0x00,0x01]));},/Unsupported SQL Server sql_variant base type/);
assert.throws(function(){Variant.decodeInstance(Buffer.from([Variant.TYPES.INT4,1,0,1,0,0,0]));},/property length/);
assert.throws(function(){Variant.decodeInstance(Buffer.concat([Buffer.from([Variant.TYPES.BIGVARCHAR,7]),Buffer.alloc(5),Buffer.from([10,0]),Buffer.from('x')]));},/raw COLLATION/);
var tooLong=Buffer.concat([u32(10),Buffer.alloc(10)]);assert.throws(function(){Variant.read(tooLong,0,9);},/exceeds declared maximum length/);
var badType=Buffer.alloc(5);badType[0]=ResultStream.TYPES.SSVARIANT;badType.writeUInt32LE(9000,1);assert.throws(function(){ResultStream.parseTypeInfo(badType,0);},/TYPE_INFO length/);

console.log('NuBloxSQL SQL Server sql_variant contract passed');
