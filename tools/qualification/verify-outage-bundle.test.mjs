import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync,unlinkSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {verifyOutageBundle} from './verify-outage-bundle.mjs';
const version='8.4.13',revision='b'.repeat(40),runId='2587';
const config={directory:null,version,runId,revision,minimumCycles:2};
function fixture(){
  const dir=mkdtempSync(join(tmpdir(),'nublox-outage-evidence-'));
  const pressure=()=>({completed:12,peakPending:10,peakSize:2,
    sizeAfterClose:0,pendingAfterClose:0});
  const cycles=[];
  for(let i=1;i<=2;i++){
    const recovery={inFlightExecutions:1,expectedInterrupted:true,
      preparedRevoked:true,oldSessionRetired:true,poolReconnected:true,
      exactlyOnce:true};
    const child={schemaVersion:1,kind:'mysql-restart-recovery',
      status:'passed',revision,failureCode:null,
      environment:{image:'mysql:'+version,serverVersion:version},
      recovery,resources:{poolClosed:{size:0}}};
    writeFileSync(join(dir,'mysql-outage-cycle-'+version+'-'+runId+'-'+i+'.json'),
      JSON.stringify(child));
    cycles.push({number:i,status:'passed',pressureBefore:pressure(),
      pressureAfter:pressure(),recovery:{status:'passed',revision,
        serverVersion:version,...recovery,poolClosed:0},
      rssAfterBytes:25_000_000,heapAfterBytes:10_000_000});
  }
  const summary={schemaVersion:1,kind:'mysql-repeated-outages',
    status:'passed',failureCode:null,revision,
    environment:{node:'v22.11.0',platform:'linux',arch:'x64',ci:true,
      image:'mysql:'+version,serverVersion:version},
    configuration:{cycles:2,poolSize:2,borrowers:12},cycles};
  const summaryPath=join(dir,'mysql-repeated-outages-'+version+'-'+runId+'.json');
  writeFileSync(summaryPath,JSON.stringify(summary));
  return {dir,summaryPath,summary};
}
test('two complete crash artifacts independently validate the pooled failure evidence',()=>{
  const x=fixture();
  try{
    const d=verifyOutageBundle({...config,directory:x.dir});
    assert.equal(d.verifiedRestarts,2);
    assert.equal(d.verifiedPressurePasses,4);
  }finally{rmSync(x.dir,{recursive:true,force:true});}
});
test('incomplete, extra and mismatched crash reports fail closed',()=>{
  for(const mutation of [
    x=>unlinkSync(join(x.dir,'mysql-outage-cycle-'+version+'-'+runId+'-2.json')),
    x=>writeFileSync(join(x.dir,'mysql-outage-cycle-'+version+'-'+runId+'-3.json'),'{}'),
    x=>{const path=join(x.dir,'mysql-outage-cycle-'+version+'-'+runId+'-1.json');
      const d=JSON.parse(readFileSync(path,'utf8'));
      d.recovery.exactlyOnce=false;writeFileSync(path,JSON.stringify(d));},
    x=>{const d=x.summary;d.cycles[1].pressureAfter.sizeAfterClose=1;
      writeFileSync(x.summaryPath,JSON.stringify(d));},
    x=>{const d=x.summary;d.revision='c'.repeat(40);
      writeFileSync(x.summaryPath,JSON.stringify(d));}
  ]){
    const x=fixture();
    try{mutation(x);assert.throws(()=>verifyOutageBundle({...config,directory:x.dir}));}
    finally{rmSync(x.dir,{recursive:true,force:true});}
  }
});
test('unrelated revision and invalid run IDs cannot be used to approve evidence',()=>{
 const x=fixture();
 try{
  assert.throws(()=>verifyOutageBundle({...config,directory:x.dir,runId:'../secret'}));
  assert.throws(()=>verifyOutageBundle({...config,directory:x.dir,revision:'c'.repeat(40)}));
  assert.throws(()=>verifyOutageBundle({...config,directory:x.dir,minimumCycles:3}));
 }finally{rmSync(x.dir,{recursive:true,force:true});}
});
