#!/usr/bin/env node
/** Independently verify a downloaded repeated-outage artifact bundle. */
import {readFileSync,readdirSync,existsSync,mkdirSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {validateOutageEvidence} from './outage-evidence.mjs';

const requireEvidence=(ok,message)=>{
  if(!ok)throw Error('Repeated-outage bundle rejected: '+message);
};
export function verifyOutageBundle({directory,version,runId,revision,minimumCycles=2}){
  requireEvidence(/^\d+\.\d+\.\d+$/.test(version??''),
    'invalid target version');
  requireEvidence(/^\d+$/.test(runId??''),'invalid Actions run ID');
  requireEvidence(/^[a-f0-9]{40}$/.test(revision??''),'invalid revision');
  const files=readdirSync(directory);
  const summaryName='mysql-repeated-outages-'+version+'-'+runId+'.json';
  requireEvidence(files.filter(name=>name===summaryName).length===1,
    'missing summary');
  const summary=JSON.parse(readFileSync(join(directory,summaryName),'utf8'));
  const decision=validateOutageEvidence(summary,{version,revision,minimumCycles});
  const prefix='mysql-outage-cycle-'+version+'-'+runId+'-';
  const cycleFiles=files.filter(x=>x.startsWith(prefix)&&x.endsWith('.json'));
  requireEvidence(cycleFiles.length===decision.cycles,'missing or duplicate cycle reports');
  for(let i=1;i<=decision.cycles;i++){
    const path=join(directory,prefix+i+'.json');
    requireEvidence(existsSync(path),'missing crash cycle '+i);
    const child=JSON.parse(readFileSync(path,'utf8'));
    const cycle=summary.cycles[i-1];
    requireEvidence(child.schemaVersion===1&&
      child.kind==='mysql-restart-recovery'&&
      child.status==='passed'&&child.failureCode===null&&
      child.revision===revision&&
      child.environment?.image==='mysql:'+version&&
      (child.environment.serverVersion===version||
       child.environment.serverVersion?.startsWith(version+'-')),
      'invalid cycle '+i+' original recovery report');
    requireEvidence(child.resources?.poolClosed?.size===0&&
      child.recovery?.inFlightExecutions===1&&
      child.recovery?.expectedInterrupted===true&&
      child.recovery?.preparedRevoked===true&&
      child.recovery?.oldSessionRetired===true&&
      child.recovery?.poolReconnected===true&&
      child.recovery?.exactlyOnce===true,
      'incomplete original recovery '+i);
    requireEvidence(cycle.recovery?.poolClosed===child.resources.poolClosed.size&&
      cycle.recovery?.inFlightExecutions===child.recovery.inFlightExecutions&&
      cycle.recovery?.exactlyOnce===child.recovery.exactlyOnce,
      'summary does not match cycle '+i);
  }
  return decision;
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===resolve(process.argv[1])){
  try{
    const decision=verifyOutageBundle({
      directory:resolve(process.argv[2]??''),
      version:process.env.NUBLOX_QUALIFICATION_MYSQL_VERSION,
      runId:process.env.GITHUB_RUN_ID,
      revision:process.env.GITHUB_SHA,
      minimumCycles:process.env.GITHUB_EVENT_NAME==='schedule'||
        process.env.GITHUB_EVENT_NAME==='workflow_dispatch'?6:2
    });
    const dir=resolve('artifacts/qualification-matrix');
    mkdirSync(dir,{recursive:true});
    const output=join(dir,'mysql-repeated-outages-evidence-'+
      process.env.GITHUB_RUN_ID+'.json');
    writeFileSync(output,JSON.stringify(decision,null,2)+'\n',{mode:0o600});
    console.log(JSON.stringify({status:decision.status,version:decision.version,
      cycles:decision.cycles,pressurePasses:decision.verifiedPressurePasses}));
  }catch{
    // Evidence and exception messages must not leak untrusted file contents.
    console.error('Repeated MySQL outage evidence failed integrity checks');
    process.exitCode=1;
  }
}
