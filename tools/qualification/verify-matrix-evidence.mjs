#!/usr/bin/env node
/** Validate that each pinned MySQL version has complete, same-revision
 * isolated-local, verified-TLS and destructive-restart qualification evidence.
 * Reads only downloaded Actions artifacts, not a live database or secrets. */
import {readFileSync,readdirSync,mkdirSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const profiles=Object.freeze({
  legacy:Object.freeze({
    versions:['8.0.44','8.4.11'],tlsVersions:['8.0.44','8.4.11'],
    localPrefix:'mysql-version-',tlsPrefix:'mysql-tls-version-'
  }),
  current:Object.freeze({
    versions:['8.4.13','9.7.4','26.10.0'],tlsVersions:['8.4.13','9.7.4'],
    localPrefix:'mysql-current-release-',tlsPrefix:'mysql-current-tls-'
  })
});
const check=(ok,message)=>{if(!ok)throw Error(message);};
const record=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const whole=value=>Number.isSafeInteger(value)&&value>=0;
const serverMatches=(actual,expected)=>typeof actual==='string'&&
  (actual===expected||actual.startsWith(expected+'-'));
const readArtifact=(directory,artifact,stem)=>{
  const dir=join(directory,artifact);
  const names=readdirSync(dir).filter(name=>name.startsWith(stem)&&name.endsWith('.json'));
  check(names.length===1,'Expected exactly one '+stem+' report in '+artifact);
  const report=JSON.parse(readFileSync(join(dir,names[0]),'utf8'));
  check(record(report),'Malformed '+stem+' report');
  return report;
};
const stage=(report,{version,revision,transport,kind})=>{
  check(report.schemaVersion===1&&report.status==='passed'&&report.kind===kind,
    'Unsuccessful or invalid '+kind+' '+version+' report');
  const env=report.environment;
  check(record(env)&&env.revision===revision&&
    env.transport===transport&&serverMatches(env.serverVersion,version)&&
    env.platform==='linux'&&env.arch==='x64'&&
    typeof env.node==='string'&&env.node.startsWith('v22.')&&env.ci===true,
    'Environment or revision mismatch for '+kind+' '+version+' '+transport);
  check(record(report.errors)&&report.errors.unexpected===0&&
    Array.isArray(report.errors.codes)&&report.errors.codes.length===0,
    'Unexpected qualification errors for '+kind+' '+version);
};
const benchmark=(report,scope)=>{
  stage(report,{...scope,kind:'benchmark'});
  check(record(report.workloads)&&
    record(report.workloads.prepared)&&record(report.workloads.cursor)&&
    record(report.workloads.pool)&&record(report.workloads.connectOnly),
    'Missing benchmark workload results for '+scope.version);
  check(whole(report.workloads.cursor.rows)&&report.workloads.cursor.rows>=100,
    'Cursor correctness qualification missing for '+scope.version);
  check(record(report.resources)&&record(report.resources.poolAfterClose)&&
    report.resources.poolAfterClose.size===0,
    'Benchmark pool resource leak for '+scope.version);
  const rejected=report.workloads.rejectedAuthentication;
  if(scope.transport==='verified-tls'){
    check(record(rejected)&&rejected.count>=1&&
      report.resources.authRejectionProfile==='verified-tls',
      'TLS rejected-authentication evidence missing for '+scope.version);
  }else{
    check(record(rejected)&&rejected.count===0&&
      report.resources.authRejectionProfile==='not-qualified-isolated-local',
      'Plaintext profile incorrectly claims rejected credentials');
  }
  check(whole(report.resources.authThreadsConnectedBefore)&&
    whole(report.resources.authThreadsConnectedAfter)&&
    report.resources.authThreadsConnectedAfter<=report.resources.authThreadsConnectedBefore,
    'Authentication connection leakage for '+scope.version);
};
const soak=(report,scope,minDurationMs)=>{
  stage(report,{...scope,kind:'soak'});
  check(record(report.workloads)&&record(report.workloads.pool)&&
    report.workloads.pool.elapsedMs>=minDurationMs&&
    whole(report.workloads.pool.completed)&&report.workloads.pool.completed>=2,
    'Incomplete sustained-duration workload for '+scope.version);
  check(report.errors.expectedSqlErrors>=1&&
    record(report.resources)&&record(report.resources.poolAfterClose)&&
    report.resources.poolAfterClose.size===0,
    'Expected SQL recovery or pool cleanup missing for '+scope.version);
};
const restart=(report,{version,revision})=>{
  check(report.schemaVersion===1&&report.kind==='mysql-restart-recovery'&&
    report.status==='passed'&&report.revision===revision&&
    report.failureCode===null,
    'Restart qualification failed for '+version);
  const env=report.environment,proof=report.recovery;
  check(record(env)&&env.image==='mysql:'+version&&
    serverMatches(env.serverVersion,version)&&
    env.platform==='linux'&&env.arch==='x64'&&
    typeof env.node==='string'&&env.node.startsWith('v22.'),
    'Restart environment or image mismatch for '+version);
  check(record(proof)&&proof.inFlightExecutions===1&&
    proof.expectedInterrupted===true&&proof.preparedRevoked===true&&
    proof.oldSessionRetired===true&&proof.poolReconnected===true&&
    proof.exactlyOnce===true,
    'Restart recovery assertions incomplete for '+version);
  check(record(report.resources)&&record(report.resources.poolClosed)&&
    report.resources.poolClosed.size===0,
    'Restart recovery pool cleanup missing for '+version);
};

/** Returns a redacted summary only after all independent evidence is valid. */
export function validateMatrixEvidence({
  directory,runId,revision,eventName='pull_request',profile='legacy'
}){
  check(typeof directory==='string'&&directory.length>0,'Artifact directory required');
  check(/^\d+$/.test(runId??''),'Numeric workflow run ID required');
  check(/^[a-f0-9]{40}$/.test(revision??''),'Exact 40-character commit SHA required');
  check(['push','pull_request','workflow_dispatch','schedule'].includes(eventName),
    'Unsupported workflow event');
  check(Object.hasOwn(profiles,profile),'Unsupported qualification matrix profile');
  const selected=profiles[profile];
  const minDurationMs=eventName==='schedule'?120000:5000;
  const validated=[];
  for(const version of selected.versions){
    const localArtifact=selected.localPrefix+version+'-'+runId;
    const local={version,revision,transport:'isolated-local'};
    benchmark(readArtifact(directory,localArtifact,'benchmark-local-'+runId+'-'),local);
    soak(readArtifact(directory,localArtifact,'soak-local-'+runId+'-'),local,minDurationMs);
    restart(readArtifact(directory,localArtifact,'mysql-restart-'+version+'-'+runId+'.json'),
      {version,revision});
    if(selected.tlsVersions.includes(version)){
      const tlsArtifact=selected.tlsPrefix+version+'-'+runId;
      const tls={version,revision,transport:'verified-tls'};
      benchmark(readArtifact(directory,tlsArtifact,'benchmark-tls-'+runId+'-'),tls);
    }
    validated.push({
      mysqlVersion:version,
      isolatedLocal:'passed',
      verifiedTls:selected.tlsVersions.includes(version)?'passed':'not-qualified',
      restartRecovery:'passed',minSoakMs:minDurationMs
    });
  }
  return Object.freeze({
    schemaVersion:1,kind:'mysql-qualification-matrix',status:'passed',
    profile,revision,eventName,runId,validated,
    artifactGroups:selected.versions.length+selected.tlsVersions.length,
    validatedReports:selected.versions.length*3+selected.tlsVersions.length
  });
}

if(process.argv[1]&&fileURLToPath(import.meta.url)===resolve(process.argv[1])){
  try{
    const result=validateMatrixEvidence({
      directory:process.argv[2],
      runId:process.env.GITHUB_RUN_ID,
      revision:process.env.GITHUB_SHA,
      eventName:process.env.GITHUB_EVENT_NAME,
      profile:process.env.NUBLOX_MYSQL_MATRIX_PROFILE??'legacy'
    });
    const dir=resolve('artifacts/qualification-matrix');
    mkdirSync(dir,{recursive:true});
    const path=join(dir,'mysql-'+result.profile+'-matrix-evidence-'+result.runId+'.json');
    writeFileSync(path,JSON.stringify(result,null,2)+'\n',{mode:0o600});
    console.log(JSON.stringify({status:result.status,revision:result.revision,
      profile:result.profile,artifactGroups:result.artifactGroups,validatedReports:result.validatedReports,
      versions:result.validated.map(x=>x.mysqlVersion)}));
  }catch(error){
    // Do not print raw reports: they may contain arbitrary untrusted fields.
    console.error('MySQL matrix qualification evidence rejected: '+error.message);
    process.exitCode=1;
  }
}
