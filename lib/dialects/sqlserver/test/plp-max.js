'use strict';

var assert = require('assert');
var Plp = require('../lib/Plp');
var ResultStream = require('../lib/ResultStream');
var IncrementalResultStream = require('../lib/IncrementalResultStream').IncrementalResultStream;

function u64(value){var b=Buffer.alloc(8);b.writeBigUInt64LE(BigInt(value));return b;}
function chunk(value){var data=Buffer.from(value);var b=Buffer.alloc(4);b.writeUInt32LE(data.length);return Buffer.concat([b,data]);}
function plp(declared,chunks){return Buffer.concat([u64(declared)].concat(chunks.map(chunk)).concat([Buffer.alloc(4)]));}

var known=Plp.read(plp(6,[Buffer.from('ab'),Buffer.from('cdef')]),0);
assert.strictEqual(known.value.toString(),'abcdef');
assert.strictEqual(known.declaredLength,6n);
assert.strictEqual(known.unknownLength,false);

var unknown=Plp.read(plp(Plp.PLP_UNKNOWN,[Buffer.from('alpha'),Buffer.from('beta')]),0);
assert.strictEqual(unknown.value.toString(),'alphabeta');
assert.strictEqual(unknown.declaredLength,null);
assert.strictEqual(unknown.unknownLength,true);

var nullable=Plp.read(u64(Plp.PLP_NULL),0);
assert.strictEqual(nullable.value,null);
var empty=Plp.read(Buffer.concat([u64(0),Buffer.alloc(4)]),0);
assert.strictEqual(empty.value.length,0);
assert.throws(function(){Plp.read(plp(7,[Buffer.from('sixsix')]),0);},/declared length/);
assert.throws(function(){Plp.read(Buffer.concat([u64(6),Buffer.from([2,0])]),0);},/Incomplete SQL Server PLP chunk length/);

function column(typeInfo,name,flags){var head=Buffer.alloc(6);head.writeUInt32LE(0,0);head.writeUInt16LE(flags||0,4);return Buffer.concat([head,typeInfo,Buffer.from([name.length]),Buffer.from(name,'utf16le')]);}
function character(type,max){var b=Buffer.alloc(8);b[0]=type;b.writeUInt16LE(max,1);return b;}
function binary(type,max){var b=Buffer.alloc(3);b[0]=type;b.writeUInt16LE(max,1);return b;}
function metadata(columns){var count=Buffer.alloc(2);count.writeUInt16LE(columns.length,0);return Buffer.concat([Buffer.from([ResultStream.TOKENS.COLMETADATA]),count].concat(columns));}
function done(rows){var b=Buffer.alloc(13);b[0]=ResultStream.TOKENS.DONE;b.writeUInt16LE(0x0010,1);b.writeBigUInt64LE(BigInt(rows),5);return b;}

var unicode=Buffer.from('NuBlox 🚀 SQL '.repeat(700),'utf16le');
var ascii=Buffer.from('portable-sql-'.repeat(900),'utf8');
var bytes=Buffer.alloc(12000);for(var i=0;i<bytes.length;i++)bytes[i]=i%251;
var payload=Buffer.concat([
  metadata([
    column(character(ResultStream.TYPES.NVARCHAR,0xffff),'unicode_max',1),
    column(character(ResultStream.TYPES.BIGVARCHAR,0xffff),'varchar_max',1),
    column(binary(ResultStream.TYPES.BIGVARBINARY,0xffff),'binary_max',1)
  ]),
  Buffer.from([ResultStream.TOKENS.ROW]),
  plp(BigInt(unicode.length),[unicode.subarray(0,3333),unicode.subarray(3333)]),
  plp(Plp.PLP_UNKNOWN,[ascii.subarray(0,4095),ascii.subarray(4095,8193),ascii.subarray(8193)]),
  plp(BigInt(bytes.length),[bytes.subarray(0,2048),bytes.subarray(2048,10000),bytes.subarray(10000)]),
  done(1)
]);

var result=ResultStream.parse(payload);
assert.strictEqual(result.rows[0].unicode_max,unicode.toString('utf16le'));
assert.strictEqual(result.rows[0].varchar_max,ascii.toString('utf8'));
assert.deepStrictEqual(result.rows[0].binary_max,bytes);

var parser=new IncrementalResultStream();
var rows=[];
for(var start=0;start<payload.length;start+=997){
  var end=Math.min(payload.length,start+997);
  rows=rows.concat(Array.from(parser.push(payload.subarray(start,end),end===payload.length)));
}
assert.strictEqual(rows.length,1);
assert.strictEqual(rows[0].unicode_max,unicode.toString('utf16le'));
assert.strictEqual(rows[0].varchar_max,ascii.toString('utf8'));
assert.deepStrictEqual(rows[0].binary_max,bytes);
assert.strictEqual(parser.result().success,true);

var nullPayload=Buffer.concat([
  metadata([column(character(ResultStream.TYPES.NVARCHAR,0xffff),'value',1)]),
  Buffer.from([ResultStream.TOKENS.ROW]),u64(Plp.PLP_NULL),done(1)
]);
assert.strictEqual(ResultStream.parse(nullPayload).rows[0].value,null);

console.log('NuBloxSQL SQL Server PLP/MAX value contract passed');
