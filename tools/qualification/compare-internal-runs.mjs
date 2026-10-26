#!/usr/bin/env node
/**
 * Diagnostic before/after comparison of the SAME native stage on one runner.
 * Inputs ordered B-A-A-B (baseline, candidate, candidate, baseline) to
 * reduce one-way JIT, scheduling and thermal drift. No performance gate.
 */
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

const STAGES=['asyncHarness','packetFraming','binaryRowDecode','serialPing','contendedPing'];
const round=n=>Math.round(n*10000)/10000;
function median(values){
  const sorted=[...values].sort((a,b)=>a-b);
  const k=Math.floor(sorted.length/2);
  return sorted.length%2?sorted[k]:(sorted[k-1]+sorted[k])/2;
}
function validate(report){
  if(report?.status!=='passed'||report.result?.kind!=='mysql-native-internals-profile')
    throw Error('Invalid native profiling report');
  const {iterations,rounds,queueDepth}=report.result.configuration??{};
  if(!Number.isSafeInteger(iterations)||iterations<8||iterations>2000||
    !Number.isSafeInteger(rounds)||rounds<2||rounds>8||
    !Number.isSafeInteger(queueDepth)||queueDepth<2||queueDepth>16||
    report.result.trials?.length!==rounds*STAGES.length)
    throw Error('Incomplete native profiling evidence');
  const keys=new Set();
  for(const item of report.result.trials){
    const key=`${item.round}:${item.stage}`;
    if(!STAGES.includes(item.stage)||!Number.isInteger(item.round)||
      item.round<1||item.round>rounds||keys.has(key)||
      item.count!==iterations||!Number.isFinite(item.workUnitsPerSecond)||
      item.workUnitsPerSecond<=0||!Number.isFinite(item.p50Ms)||item.p50Ms<0)
      throw Error('Malformed native profile trial');
    keys.add(key);
  }
}
export function compareProfiles(reports){
  if(!Array.isArray(reports)||reports.length!==4)
    throw Error('Expected four B-A-A-B reports');
  reports.forEach(validate);
  const config=JSON.stringify(reports[0].result.configuration);
  for(const item of reports){
    if(JSON.stringify(item.result.configuration)!==config||
      item.environment?.node!==reports[0].environment?.node||
      item.environment?.platform!==reports[0].environment?.platform||
      item.environment?.arch!==reports[0].environment?.arch)
      throw Error('Profile environment or configuration mismatch');
  }
  if(reports[0].environment?.revision===reports[1].environment?.revision||
    reports[1].environment?.revision!==reports[2].environment?.revision||
    reports[0].environment?.revision!==reports[3].environment?.revision)
    throw Error('Profiles do not have distinct, paired baseline and candidate revisions');
  return Object.freeze({
    schemaVersion:1,
    evidence:'same-runner B-A-A-B; descriptive only',
    baselineRevision:reports[0].environment.revision,
    candidateRevision:reports[1].environment.revision,
    configuration:reports[0].result.configuration,
    caveat:'CI runner noise, JIT and thermal drift prevent definitive claims; no fixed performance gate.',
    stages:STAGES.map(stage=>{
      const values=reports.map(report=>
        report.result.trials.filter(x=>x.stage===stage)
          .map(x=>x.workUnitsPerSecond));
      const base=median([...values[0],...values[3]]);
      const candidate=median([...values[1],...values[2]]);
      return {
        stage,
        baselineMedianWorkUnitsPerSecond:round(base),
        candidateMedianWorkUnitsPerSecond:round(candidate),
        candidateToBaselineThroughputRatio:round(candidate/base),
        baselineRoundCount:values[0].length+values[3].length,
        candidateRoundCount:values[1].length+values[2].length
      };
    })
  });
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const files=process.argv.slice(2);
  if(files.length!==4)throw Error('Pass four B-A-A-B profile JSON files');
  const data=compareProfiles(files.map(path=>
    JSON.parse(readFileSync(resolve(path),'utf8'))));
  const dir=resolve('artifacts/qualification');
  mkdirSync(dir,{recursive:true});
  const outfile=resolve(dir,`native-internal-ab-${Date.now()}.json`);
  writeFileSync(outfile,JSON.stringify(data,null,2)+'\n',{mode:0o600});
  console.log(JSON.stringify({report:outfile,...data},null,2));
}
