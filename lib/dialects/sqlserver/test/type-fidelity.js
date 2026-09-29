'use strict';

var assert = require('assert');
var ResultStream = require('../lib/ResultStream');

function column(typeInfo, name, flags) {
  var head=Buffer.alloc(6);head.writeUInt32LE(0,0);head.writeUInt16LE(flags||0,4);
  return Buffer.concat([head,typeInfo,Buffer.from([name.length]),Buffer.from(name,'utf16le')]);
}
function metadata(columns) {
  var count=Buffer.alloc(2);count.writeUInt16LE(columns.length,0);
  return Buffer.concat([Buffer.from([ResultStream.TOKENS.COLMETADATA]),count].concat(columns));
}
function done(rowCount) {
  var b=Buffer.alloc(13);b[0]=ResultStream.TOKENS.DONE;b.writeUInt16LE(0x0010,1);b.writeBigUInt64LE(BigInt(rowCount),5);return b;
}
function unsignedLE(value,length) {
  var out=Buffer.alloc(length),v=BigInt(value);
  for(var i=0;i<length;i++){out[i]=Number(v&255n);v>>=8n;}
  if(v!==0n)throw new RangeError('test value does not fit requested width');
  return out;
}
function decimal(value,precision,scale) {
  var negative=value<0n,magnitude=negative?-value:value;
  var width=precision<=9?4:(precision<=19?8:(precision<=28?12:16));
  return Buffer.concat([Buffer.from([1+width,negative?0:1]),unsignedLE(magnitude,width)]);
}
function temporal(value,length) { return Buffer.concat([Buffer.from([length]),unsignedLE(value,length)]); }
function daysSinceYearOne(year,month,day) {
  return Math.round((Date.UTC(year,month-1,day)-(-62135596800000))/86400000);
}
function guid(value) {
  var parts=value.split('-');
  var out=Buffer.alloc(17);out[0]=16;
  out.writeUInt32LE(parseInt(parts[0],16),1);
  out.writeUInt16LE(parseInt(parts[1],16),5);
  out.writeUInt16LE(parseInt(parts[2],16),7);
  Buffer.from(parts[3]+parts[4],'hex').copy(out,9);
  return out;
}

var T=ResultStream.TYPES;
var scale=7;
var seconds=BigInt(13*3600+14*60+15);
var ticks=seconds*10000000n+1234567n;
var dateDays=BigInt(daysSinceYearOne(2026,9,29));
var decimalMagnitude=12345678901234567890123456n;
var money=Buffer.alloc(8);money.writeBigInt64LE(-987654321n,0);
var smallMoney=Buffer.alloc(4);smallMoney.writeInt32LE(1234567,0);
var offset=Buffer.alloc(2);offset.writeInt16LE(90,0);

var response=ResultStream.parse(Buffer.concat([
  metadata([
    column(Buffer.from([T.DECIMALN,13,26,6]),'exact_decimal',1),
    column(Buffer.from([T.MONEY]),'money_value'),
    column(Buffer.from([T.MONEY4]),'small_money'),
    column(Buffer.from([T.GUID]),'guid_value',1),
    column(Buffer.from([T.DATE]),'date_value',1),
    column(Buffer.from([T.TIME,scale]),'time_value',1),
    column(Buffer.from([T.DATETIME2,scale]),'datetime2_value',1),
    column(Buffer.from([T.DATETIMEOFFSET,scale]),'datetimeoffset_value',1)
  ]),
  Buffer.concat([
    Buffer.from([ResultStream.TOKENS.ROW]),
    decimal(decimalMagnitude,26,6),
    money,
    smallMoney,
    guid('00112233-4455-6677-8899-aabbccddeeff'),
    temporal(dateDays,3),
    temporal(ticks,5),
    Buffer.concat([Buffer.from([8]),unsignedLE(ticks,5),unsignedLE(dateDays,3)]),
    Buffer.concat([Buffer.from([10]),unsignedLE(ticks,5),unsignedLE(dateDays,3),offset])
  ]),
  done(1)
]));

assert.strictEqual(response.success,true);
assert.deepStrictEqual(response.rows,[{
  exact_decimal:'12345678901234567890.123456',
  money_value:'-98765.4321',
  small_money:'123.4567',
  guid_value:'00112233-4455-6677-8899-aabbccddeeff',
  date_value:'2026-09-29',
  time_value:'13:14:15.1234567',
  datetime2_value:'2026-09-29T13:14:15.1234567',
  datetimeoffset_value:'2026-09-29T13:14:15.1234567+01:30'
}]);
assert.strictEqual(response.columns[0].precision,26);
assert.strictEqual(response.columns[0].scale,6);
assert.strictEqual(response.columns[5].scale,7);

var negative=ResultStream.formatScaledInteger(-12n,4);
assert.strictEqual(negative,'-0.0012');
assert.strictEqual(ResultStream.formatScaledInteger(1200n,4),'0.1200');
assert.throws(function(){ResultStream.parseTypeInfo(Buffer.from([T.TIME,8]),0);},/temporal scale/);

console.log('NuBloxSQL SQL Server lossless type-fidelity contract passed');
