'use strict';

var assert = require('assert');
var ResultStream = require('../lib/ResultStream');
var IncrementalResultStream = require('../lib/IncrementalResultStream').IncrementalResultStream;

function column(typeInfo, name, flags) {
  var head=Buffer.alloc(6);head.writeUInt32LE(0,0);head.writeUInt16LE(flags||0,4);
  return Buffer.concat([head,typeInfo,Buffer.from([name.length]),Buffer.from(name,'utf16le')]);
}
function fixed(type){return Buffer.from([type]);}
function character(type,max){var b=Buffer.alloc(8);b[0]=type;b.writeUInt16LE(max,1);return b;}
function metadata(columns){var count=Buffer.alloc(2);count.writeUInt16LE(columns.length,0);return Buffer.concat([Buffer.from([ResultStream.TOKENS.COLMETADATA]),count].concat(columns));}
function done(rowCount){var b=Buffer.alloc(13);b[0]=ResultStream.TOKENS.DONE;b.writeUInt16LE(0x0010,1);b.writeBigUInt64LE(BigInt(rowCount),5);return b;}
function row(idValue,nameValue){var id=Buffer.alloc(4);id.writeInt32LE(idValue,0);var name=Buffer.from(nameValue,'utf16le'),len=Buffer.alloc(2);len.writeUInt16LE(name.length,0);return Buffer.concat([Buffer.from([ResultStream.TOKENS.ROW]),id,len,name]);}

var payload=Buffer.concat([
  metadata([column(fixed(ResultStream.TYPES.INT4),'id'),column(character(ResultStream.TYPES.NVARCHAR,80),'name',1)]),
  row(1,'one'),row(2,'two'),row(3,'three'),done(3)
]);
var parser=new IncrementalResultStream();
var rows=[];
var cuts=[1,5,13,29,47,payload.length-2,payload.length],start=0;
for(var i=0;i<cuts.length;i++){
  var end=cuts[i];
  var decoded=parser.push(payload.subarray(start,end),end===payload.length);
  rows=rows.concat(Array.from(decoded));
  start=end;
}
assert.deepStrictEqual(rows,[{id:1,name:'one'},{id:2,name:'two'},{id:3,name:'three'}]);
assert.strictEqual(parser.ended,true);
assert.strictEqual(parser.result().rowCount,3n);
assert.strictEqual(parser.result().success,true);
assert.strictEqual(parser.columns.length,2);

var incomplete=new IncrementalResultStream();
assert.throws(function(){incomplete.push(payload.subarray(0,payload.length-1),true);},/Incomplete SQL Server result token/);
console.log('NuBloxSQL SQL Server incremental result streaming passed');
