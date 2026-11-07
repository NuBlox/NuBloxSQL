import {test} from 'node:test';
import assert from 'node:assert/strict';
import {T,size} from '../dist/vendors/mysql/protocol/primitives.js';
import {textValues} from '../dist/vendors/mysql/text-results.js';
import {columnKeys,objectRow} from '../dist/vendors/mysql/types.js';

const column=(name,type,charset=63,unsigned=false)=>({
  name,schema:'',table:'',originalTable:'',originalName:'',
  type,charset,length:1024,flags:unsigned?32:0,decimals:0,unsigned
});
const cells=values=>Buffer.concat(values.map(value=>
  value===null?Buffer.from([0xfb]):
    Buffer.concat([size(value.length),value])
));
const string=s=>Buffer.from(s,'utf8');

test('Classic text rows preserve numeric precision, collations and exact text',()=>{
  const columns=[
    column('id',T.LONGLONG),
    column('same',T.LONG,63,true),
    column('same',T.NEWDECIMAL),
    column('value',T.DOUBLE),
    column('name',T.VAR_STRING,45),
    column('blob',T.BLOB),
    column('date',T.DATE),
    column('duration',T.TIME),
    column('json',T.JSON),
    column('bits',T.BIT),
    column('year',T.YEAR),
    column('missing',T.VAR_STRING,45)
  ];
  const buffer=Buffer.from([0,255,128]);
  const values=textValues(cells([
    string('9223372036854775807'),string('4294967295'),
    string('-12345678901234567890.123456'),string('1.234e-5'),
    string('Schöne Grüße'),buffer,string('0000-00-00'),
    string('-838:59:59.123456'),string('{"big":12345678901234567890}'),
    Buffer.from([0xa5,0x00]),string('2026'),null
  ]),columns);
  assert.deepEqual(values,[
    9223372036854775807n,4294967295,'-12345678901234567890.123456',
    0.00001234,'Schöne Grüße',buffer,'0000-00-00',
    '-838:59:59.123456','{"big":12345678901234567890}',
    Buffer.from([0xa5,0x00]),2026,null
  ]);
  const keys=columnKeys(columns);
  assert.equal(keys[1],'same');
  assert.equal(keys[2],'same#2');
  const row=objectRow(values,keys);
  assert.equal(Object.getPrototypeOf(row),null);
  assert.equal(row['same#2'],'-12345678901234567890.123456');
});

test('strict text scalar decoding rejects out-of-range and malformed fields',()=>{
  const invalid=[
    [column('n',T.TINY),string('128')],
    [column('n',T.TINY,63,true),string('-1')],
    [column('n',T.LONGLONG),string('9223372036854775808')],
    [column('n',T.LONGLONG,63,true),string('18446744073709551616')],
    [column('n',T.LONG),string('1.0')],
    [column('n',T.LONG),Buffer.from([0xff])],
    [column('n',T.NEWDECIMAL),string('1e5')],
    [column('n',T.DOUBLE),string('NaN')],
    [column('n',T.DOUBLE),string('1e999')],
    [column('n',T.DATE),string('today')],
    [column('n',T.TIME),string('12:30')],
    [column('n',T.YEAR),string('1800')],
    [column('n',T.VAR_STRING,999),string('unsupported collation')],
    [column('n',T.VAR_STRING,45),Buffer.from([0xc3,0x28])],
    [column('n',77),string('unsupported type')]
  ];
  for(const [col,value] of invalid){
    assert.throws(()=>textValues(cells([value]),[col]),
      error=>error.code==='PROTOCOL_ERROR',col.name+' '+col.type);
  }
});

test('text rows reject short, overlong and shifted wire fields',()=>{
  const columns=[column('a',T.LONG),column('b',T.VAR_STRING,45)];
  for(const packet of [
    Buffer.from([0x01,0x31]), // missing second field
    Buffer.from([0x02,0x31]), // truncated first value
    cells([string('1'),string('x'),string('extra')]),
    Buffer.from([0xfb,0xfc]), // truncated two-byte length
    Buffer.from([0xff]), // invalid length encoding
    Buffer.from([0xfe,0xff,0xff]) // incomplete eight-byte length
  ]){
    assert.throws(()=>textValues(packet,columns),
      error=>error.code==='PROTOCOL_ERROR');
  }
});

test('NULL markers and empty byte strings are different text values',()=>{
  const cols=[column('nullable',T.LONG),column('empty',T.VAR_STRING,45),
    column('binary',T.BLOB),column('json',T.JSON)];
  assert.deepEqual(textValues(cells([null,Buffer.alloc(0),Buffer.alloc(0),
    string('{}')]),cols),[null,'',Buffer.alloc(0),'{}']);
});
