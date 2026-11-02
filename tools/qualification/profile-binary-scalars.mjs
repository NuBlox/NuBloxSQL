#!/usr/bin/env node
/**
 * Synthetic numeric-only MySQL binary row decode profile. Compares exact
 * baseline/candidate builds in B-A-A-B order without DB/network effects.
 * Diagnostics only: cannot certify client end-to-end or vendor superiority.
 */
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {mkdirSync,writeFileSync} from 'node:fs';
import {platform,arch} from 'node:os';

const input={};
for(const arg of process.argv.slice(2)){
  const m=/^--(baseline|candidate|iterations)=([^=]+)$/.exec(arg);
  if(!m||Object.hasOwn(input,m[1]))throw Error('Invalid numeric decoder profile arguments');
  input[m[1]]=m[2];
}
const count=Number(input.iterations);
if(!input.baseline||!input.candidate||!/^[0-9]+$/.test(input.iterations??'')||
  !Number.isSafeInteger(count)||count<1000||count>100000)
  throw Error('Numeric decoder profiler requires bounded baseline/candidate');

const previous=await import(pathToFileURL(resolve(input.baseline)).href);
const candidate=await import(pathToFileURL(resolve(input.candidate)).href);
const T={TINY:1,SHORT:2,LONG:3,FLOAT:4,DOUBLE:5,LONGLONG:8,INT24:9,YEAR:13};

const types=[
  {type:T.LONGLONG,bytes:8,write:b=>b.writeBigInt64LE(-12345678901234n)},
  {type:T.LONGLONG,bytes:8,unsigned:true,
    write:b=>b.writeBigUInt64LE(18446744073709551615n)},
  {type:T.LONG,bytes:4,write:b=>b.writeInt32LE(-123456789)},
  {type:T.LONG,bytes:4,unsigned:true,write:b=>b.writeUInt32LE(4294967295)},
  {type:T.INT24,bytes:4,write:b=>b.writeInt32LE(-3000)},
  {type:T.SHORT,bytes:2,write:b=>b.writeInt16LE(-12345)},
  {type:T.YEAR,bytes:2,unsigned:true,write:b=>b.writeUInt16LE(2026)},
  {type:T.TINY,bytes:1,write:b=>b.writeInt8(-127)},
  {type:T.FLOAT,bytes:4,write:b=>b.writeFloatLE(-3.125)},
  {type:T.DOUBLE,bytes:8,write:b=>b.writeDoubleLE(-1234.875)}
];
function sample(size,nullable=false){
  const cols=Array.from({length:size},(_,i)=>({
    name:'c'+i,type:types[i%types.length].type,
    unsigned:Boolean(types[i%types.length].unsigned),
    charset:63,length:64,flags:0,decimals:0
  }));
  const bitmap=Buffer.alloc(Math.ceil((size+2)/8)),bytes=[];
  for(let i=0;i<size;i++){
    if(nullable&&i%7===0){bitmap[(i+2)>>3]|=1<<((i+2)%8);continue;}
    const def=types[i%types.length],b=Buffer.alloc(def.bytes);
    def.write(b);bytes.push(b);
  }
  return {cols,packet:Buffer.concat([Buffer.from([0]),bitmap,...bytes])};
}
const cases=[
  {name:'singleSignedBigint',...sample(1)},
  {name:'mixedNumeric16',...sample(16)},
  {name:'mixedNumeric64',...sample(64)},
  {name:'mixedNullable64',...sample(64,true)}
];
const summaries=[];
for(const scenario of cases){
  const old=previous.binaryValues(scenario.packet,scenario.cols);
  const fresh=candidate.binaryValues(scenario.packet,scenario.cols);
  assert.deepEqual(fresh,old,'Decoded scalar values differ from baseline');
  const measure=(name,decoder)=>{
    for(let i=0;i<3000;i++)decoder.binaryValues(scenario.packet,scenario.cols);
    let checksum=0;
    const start=performance.now();
    for(let i=0;i<count;i++){
      const values=decoder.binaryValues(scenario.packet,scenario.cols);
      checksum+=values.length;
      if(typeof values[0]==='bigint')checksum+=Number(values[0]&0xffn);
    }
    const elapsedMs=performance.now()-start;
    assert.ok(Number.isFinite(elapsedMs)&&elapsedMs>0);
    return {name,checksum,elapsedMs};
  };
  const outcomes=[
    measure('baseline',previous),measure('candidate',candidate),
    measure('candidate',candidate),measure('baseline',previous)
  ];
  assert.equal(new Set(outcomes.map(x=>x.checksum)).size,1,
    'Non-identical work during benchmark');
  const avg=name=>outcomes.filter(x=>x.name===name)
    .reduce((sum,x)=>sum+x.elapsedMs,0)/2;
  const a=avg('baseline'),b=avg('candidate');
  summaries.push({
    scenario:scenario.name,columns:scenario.cols.length,iterations:count,
    baselineMs:Number(a.toFixed(4)),candidateMs:Number(b.toFixed(4)),
    candidateToBaselineRatio:Number((b/a).toFixed(4)),
    checksum:outcomes[0].checksum,
    order:'baseline-candidate-candidate-baseline'
  });
}
const result={
  schemaVersion:1,kind:'mysql-fixed-numeric-row-decoder-microprofile',
  environment:{node:process.version,platform:platform(),arch:arch(),
    baselineRevision:process.env.BASE_SHA??null,revision:process.env.GITHUB_SHA??null,
    ci:Boolean(process.env.CI)},
  scope:'synthetic binary row decoder only, without SQL, packet framing, network or MySQL execution',
  conclusion:'diagnostic only; no vendor superiority or end-to-end speed claim',
  trials:summaries
};
const dir=resolve('artifacts/qualification');
mkdirSync(dir,{recursive:true});
const runId=String(process.env.GITHUB_RUN_ID??'local').replace(/[^a-zA-Z0-9-]/g,'');
const filename=resolve(dir,'mysql-numeric-decode-ab-'+runId+'.json');
writeFileSync(filename,JSON.stringify(result,null,2)+'\n',{mode:0o600});
console.log(JSON.stringify(result,null,2));
