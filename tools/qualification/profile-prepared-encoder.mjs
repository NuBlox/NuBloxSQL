#!/usr/bin/env node
/**
 * Synthetic, staged COM_STMT_EXECUTE encoder microprofile.
 * No sockets, DB or customer data; ratios are diagnostic and not production
 * latency predictions. Run baseline-candidate-candidate-baseline (BAAB)
 * in the SAME Node process with identical arguments and checksum controls.
 */
import {performance} from 'node:perf_hooks';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {mkdirSync,writeFileSync} from 'node:fs';
import {arch,platform} from 'node:os';

function config(args){
  const data={};
  for(const arg of args){
    const match=/^--(baseline|candidate|iterations)=([^=]+)$/.exec(arg);
    if(!match||Object.hasOwn(data,match[1]))
      throw Error('Missing or duplicate encoder profile option');
    data[match[1]]=match[2];
  }
  if(!data.baseline||!data.candidate||
    !/^[0-9]+$/.test(data.iterations??'')||
    !Number.isSafeInteger(Number(data.iterations))||
    Number(data.iterations)<1000||Number(data.iterations)>500000)
    throw Error('Encoder profile needs bounded baseline/candidate and iterations');
  return {baseline:resolve(data.baseline),candidate:resolve(data.candidate),
    iterations:Number(data.iterations)};
}
const {baseline,candidate,iterations}=config(process.argv.slice(2));
const old=await import(pathToFileURL(baseline).href);
const fresh=await import(pathToFileURL(candidate).href);
const cases=Object.freeze([
  {name:'oneInteger',params:[42]},
  {name:'fourMixed',params:[null,12,'é漢字',Uint8Array.from([0,1,255])]},
  {name:'oneUtf8',params:['α'.repeat(80)]},
  {name:'zeroParameters',params:[]}
]);
const observed=[];
for(const {name,params} of cases){
  const reference=old.execute(1234,params);
  const trial= fresh.execute(1234,params);
  if(!reference.equals(trial))throw Error('COM_STMT_EXECUTE wire bytes differ');
  const run=(label,encoder)=>{
    for(let i=0;i<6000;i++)encoder.execute(1234,params);
    let checksum=0;
    const before=performance.now();
    for(let i=0;i<iterations;i++){
      const buffer=encoder.execute(1234,params);
      checksum=(checksum+buffer.length+buffer[buffer.length-1])>>>0;
    }
    const elapsedMs=performance.now()-before;
    if(!Number.isFinite(elapsedMs)||elapsedMs<=0)
      throw Error('Invalid encoder stage duration');
    return {label,elapsedMs,checksum};
  };
  const trials=[run('baseline',old),run('candidate',fresh),
    run('candidate',fresh),run('baseline',old)];
  if(new Set(trials.map(t=>t.checksum)).size!==1)
    throw Error('Encoder work-unit checksums differ');
  const average=label=>trials.filter(t=>t.label===label)
    .reduce((s,t)=>s+t.elapsedMs,0)/2;
  const baselineMs=average('baseline'),candidateMs=average('candidate');
  observed.push({
    scenario:name,iterations,
    baselineMs:Math.round(baselineMs*1e4)/1e4,
    candidateMs:Math.round(candidateMs*1e4)/1e4,
    candidateToBaselineMsRatio:Math.round(candidateMs/baselineMs*1e4)/1e4,
    controlChecksum:trials[0].checksum,
    order:'baseline-candidate-candidate-baseline'
  });
}
const report={
  schemaVersion:1,kind:'mysql-prepared-encoder-microprofile',
  environment:{node:process.version,platform:platform(),arch:arch(),
    headRevision:process.env.GITHUB_SHA??null,
    baselineRevision:process.env.BASELINE_SHA??null,
    ci:Boolean(process.env.CI)},
  scope:'synthetic synchronous packet encoding; excludes network, authentication, server execution and decode',
  conclusion:'diagnostic only; shared-runner CPU noise and small sample prevent commercial speed claims',
  trials:observed
};
const output=resolve('artifacts/qualification');
mkdirSync(output,{recursive:true});
const filename=resolve(output,'mysql-prepared-encoder-ab-'+
  String(process.env.GITHUB_RUN_ID??'local').replace(/[^0-9A-Za-z-]/g,'')+'.json');
writeFileSync(filename,JSON.stringify(report,null,2)+'\n',{mode:0o600});
console.log(JSON.stringify(report,null,2));
