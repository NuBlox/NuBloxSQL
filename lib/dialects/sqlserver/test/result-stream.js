'use strict';

var assert = require('assert');
var ResultStream = require('../lib/ResultStream');

function column(typeInfo, name, flags) {
  var head=Buffer.alloc(6);head.writeUInt32LE(0,0);head.writeUInt16LE(flags||0,4);
  return Buffer.concat([head,typeInfo,Buffer.from([name.length]),Buffer.from(name,'utf16le')]);
}
function fixed(type){return Buffer.from([type]);}
function variable(type,max){return Buffer.from([type,max]);}
function character(type,max){var b=Buffer.alloc(8);b[0]=type;b.writeUInt16LE(max,1);return b;}
function binary(type,max){var b=Buffer.alloc(3);b[0]=type;b.writeUInt16LE(max,1);return b;}
function metadata(columns){var count=Buffer.alloc(2);count.writeUInt16LE(columns.length,0);return Buffer.concat([Buffer.from([ResultStream.TOKENS.COLMETADATA]),count].concat(columns));}
function done(rowCount){var b=Buffer.alloc(13);b[0]=ResultStream.TOKENS.DONE;b.writeUInt16LE(0x0010,1);b.writeBigUInt64LE(BigInt(rowCount),5);return b;}

var id=Buffer.alloc(4);id.writeInt32LE(42,0);
var name=Buffer.from('Stephen','utf16le'),nameLen=Buffer.alloc(2);nameLen.writeUInt16LE(name.length,0);
var bytes=Buffer.from([0xde,0xad,0xbe,0xef]),bytesLen=Buffer.alloc(2);bytesLen.writeUInt16LE(bytes.length,0);
var response=ResultStream.parse(Buffer.concat([
  metadata([
    column(fixed(ResultStream.TYPES.INT4),'id'),
    column(character(ResultStream.TYPES.NVARCHAR,80),'name',1),
    column(binary(ResultStream.TYPES.BIGVARBINARY,32),'payload',1)
  ]),
  Buffer.concat([Buffer.from([ResultStream.TOKENS.ROW]),id,nameLen,name,bytesLen,bytes]),
  done(1)
]));
assert.strictEqual(response.success,true);
assert.deepStrictEqual(response.rows,[{id:42,name:'Stephen',payload:Buffer.from([0xde,0xad,0xbe,0xef])}]);
assert.strictEqual(response.rowCount,1n);
assert.strictEqual(response.columns[1].type,ResultStream.TYPES.NVARCHAR);

var score=Buffer.alloc(5);score[0]=4;score.writeInt32LE(-7,1);
var compressed=ResultStream.parse(Buffer.concat([
  metadata([
    column(variable(ResultStream.TYPES.INTN,4),'maybe',1),
    column(variable(ResultStream.TYPES.INTN,4),'score',1)
  ]),
  Buffer.concat([Buffer.from([ResultStream.TOKENS.NBCROW]),Buffer.from([0x01]),score]),
  done(1)
]));
assert.deepStrictEqual(compressed.rows,[{maybe:null,score:-7}]);

assert.throws(function(){ResultStream.parse(Buffer.from([0x99]));},/Unsupported SQL Server result token/);
assert.throws(function(){ResultStream.parse(Buffer.from([ResultStream.TOKENS.COLMETADATA,0x01]));},RangeError);
console.log('NuBloxSQL SQL Server result-stream foundation passed');
