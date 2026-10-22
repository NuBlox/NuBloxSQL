import {test} from 'node:test';
import assert from 'node:assert/strict';
import {T,sized,u16,u32} from '../dist/vendors/mysql/protocol/primitives.js';
import {binaryValues,binaryRow,columnKeys,objectRow} from '../dist/vendors/mysql/types.js';
import {eofStatus,assertSingleResult,ok,field} from '../dist/vendors/mysql/protocol/results.js';
import {readMetadata} from '../dist/vendors/mysql/metadata.js';

const column=name=>({name,type:T.LONGLONG,charset:63,unsigned:false,
 schema:'test',table:'t',length:20,flags:0,decimals:0});
const int=n=>{const b=Buffer.alloc(8);b.writeBigInt64LE(BigInt(n));return b;};
const wire=(...values)=>Buffer.concat([Buffer.from([0]),Buffer.alloc(Math.ceil((values.length+2)/8)),...values.map(int)]);
const definition=(name,originalName=name,table='alias',originalTable='real_table')=>Buffer.concat([
 sized(Buffer.from('def')),sized(Buffer.from('test')),
 sized(Buffer.from(table)),sized(Buffer.from(originalTable)),
 sized(Buffer.from(name)),sized(Buffer.from(originalName)),
 Buffer.from([12]),u16(63),u32(20),Buffer.from([T.LONGLONG]),
 u16(0),Buffer.from([0,0,0])
]);

test('duplicate labels retain all positional values and cannot overwrite real names',()=>{
 const columns=['a','a','a#2','a','a#3','__proto__','__proto__'].map(column);
 const keys=columnKeys(columns);
 assert.deepEqual(keys,['a','a#4','a#2','a#5','a#3','__proto__','__proto__#2']);
 const values=binaryValues(wire(10,20,30,40,50,60,70),columns);
 assert.deepEqual(values,[10n,20n,30n,40n,50n,60n,70n]);
 const row=objectRow(values,keys);
 assert.deepEqual(keys.map(k=>row[k]),values);
 assert.equal(Object.getPrototypeOf(row),null);
 assert.equal(row['__proto__'],60n);
 assert.equal(row['__proto__#2'],70n);
 assert.deepEqual(binaryRow(wire(10,20,30,40,50,60,70),columns),row);
});

test('null bitmap and same-name columns remain aligned by position',()=>{
 const columns=[column('id'),column('id'),column('id')];
 const packet=Buffer.concat([Buffer.from([0,1<<3]),int(1),int(3)]);
 const values=binaryValues(packet,columns);
 assert.deepEqual(values,[1n,null,3n]);
 assert.deepEqual(columnKeys(columns),['id','id#2','id#3']);
 assert.deepEqual(Object.values(binaryRow(packet,columns)),values);
});

test('MySQL protocol 4.1 metadata keeps physical column origin, name and alias',()=>{
 const result=field(definition('display_name','actual_name','t','original_t'));
 assert.equal(result.name,'display_name');
 assert.equal(result.originalName,'actual_name');
 assert.equal(result.table,'t');
 assert.equal(result.originalTable,'original_t');
 assert.equal(result.schema,'test');
 assert.throws(()=>field(Buffer.concat([definition('x'),Buffer.from([0])])),/Trailing/);
});

test('EOF flags and warnings are parsed strictly: no silent extra results',()=>{
 const eof=Buffer.from([0xfe,5,0,2,0]);
 assert.deepEqual(eofStatus(eof),{warnings:5,status:2});
 assert.doesNotThrow(()=>assertSingleResult(2));
 assert.throws(()=>assertSingleResult(8),e=>e.code==='UNSUPPORTED_FEATURE');
 assert.throws(()=>assertSingleResult(0x1000),e=>e.code==='UNSUPPORTED_FEATURE');
 for(const invalid of [Buffer.from([0xfe]),Buffer.from([0xfe,0,0,2]),
   Buffer.from([0,0,0,2,0]),Buffer.from([0xfe,0,0,2,0,0])])
   assert.throws(()=>eofStatus(invalid),/Malformed/);
 // The OK response may also signal additional result sets, even if the
 // initial command did not return a row-bearing result set.
 const multi=Buffer.from([0,0,0,8,0,0,0]);
 assert.throws(()=>ok(multi),e=>e.code==='UNSUPPORTED_FEATURE');
 assert.deepEqual(ok(Buffer.from([0,0,0,2,0,0,0])).rows,[]);
});

test('metadata consumer rejects truncated or multiple-result boundaries',async()=>{
 const get=(packets)=>async()=>{if(!packets.length)throw Error('Missing packet');return packets.shift();};
 const cols=await readMetadata(get([definition('value'),Buffer.from([0xfe,0,0,2,0])]),1);
 assert.equal(cols[0].name,'value');
 const bad=[definition('id'),Buffer.from([0xfe,0,0,8,0])];
 await assert.rejects(readMetadata(get(bad),1),e=>e.code==='UNSUPPORTED_FEATURE');
 await assert.rejects(readMetadata(get([definition('id'),Buffer.from([0xfe])]),1),/Malformed/);
});

test('seeded malformed-binary-row corpus always fails closed or returns exact column count',()=>{
 const cols=[column('one'),column('two'),column('three'),column('four')];
 let seed=0x12345678,valid=0,invalid=0;
 const next=()=>{seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return seed>>>0;};
 for(let i=0;i<2500;i++){
   const length=next()%55,packet=Buffer.alloc(length);
   for(let j=0;j<length;j++)packet[j]=next()&255;
   try{
     const values=binaryValues(packet,cols);
     assert.equal(values.length,cols.length);
     valid++;
   }catch(error){
     assert.ok(error instanceof Error);
     invalid++;
   }
 }
 assert.ok(invalid>2000,'Most random malformed packets should fail');
 assert.equal(valid+invalid,2500);
});
