import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,unlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {validateMatrixEvidence} from './verify-matrix-evidence.mjs';

const revision='a'.repeat(40);
const runId='12345';
const versions=['8.0.44','8.4.11'];
const context={runId,revision,eventName:'pull_request'};

function fixture(profile='legacy'){
 const chosenVersions=profile==='current'?['8.4.13','9.7.4','26.10.0']:versions;
 const tlsVersions=profile==='current'?['8.4.13','9.7.4']:versions;
 const localPrefix=profile==='current'?'mysql-current-release-':'mysql-version-';
 const tlsPrefix=profile==='current'?'mysql-current-tls-':'mysql-tls-version-';
 const directory=mkdtempSync(join(tmpdir(),'nublox-matrix-'));
 const reports=new Map();
 const emit=(artifact,file,report)=>{
  const path=join(directory,artifact);
  mkdirSync(path,{recursive:true});
  const name=join(path,file);
  writeFileSync(name,JSON.stringify(report));
  reports.set(artifact+'/'+file,name);
 };
 for(const version of chosenVersions){
  const base={node:'v22.14.0',platform:'linux',arch:'x64',ci:true,
   serverVersion:version,revision};
  const bench=(transport)=>({
   schemaVersion:1,kind:'benchmark',status:'passed',
   environment:{...base,transport},
   workloads:{
    connectOnly:{count:12},rejectedAuthentication:{count:transport==='verified-tls'?6:0},
    prepared:{count:30},pool:{completed:30},cursor:{rows:1000}
   },
   resources:{poolAfterClose:{size:0},authThreadsConnectedBefore:2,
    authThreadsConnectedAfter:2,
    authRejectionProfile:transport==='verified-tls'
     ?'verified-tls':'not-qualified-isolated-local'},
   errors:{unexpected:0,codes:[],expectedSqlErrors:0}
  });
  const soak={
   schemaVersion:1,kind:'soak',status:'passed',
   environment:{...base,transport:'isolated-local'},
   workloads:{pool:{elapsedMs:5200,completed:200}},
   resources:{poolAfterClose:{size:0}},
   errors:{unexpected:0,codes:[],expectedSqlErrors:6}
  };
  const restart={
   schemaVersion:1,kind:'mysql-restart-recovery',status:'passed',revision,
   environment:{node:'v22.14.0',platform:'linux',arch:'x64',
    image:'mysql:'+version,serverVersion:version},
   recovery:{inFlightExecutions:1,expectedInterrupted:true,preparedRevoked:true,
    oldSessionRetired:true,poolReconnected:true,exactlyOnce:true},
   resources:{poolClosed:{size:0}},failureCode:null
  };
  const local=localPrefix+version+'-'+runId;
  const tls=tlsPrefix+version+'-'+runId;
  emit(local,'benchmark-local-'+runId+'-100.json',bench('isolated-local'));
  emit(local,'soak-local-'+runId+'-200.json',soak);
  emit(local,'mysql-restart-'+version+'-'+runId+'.json',restart);
  if(tlsVersions.includes(version))
   emit(tls,'benchmark-tls-'+runId+'-300.json',bench('verified-tls'));
 }
 return {
  directory,reports,
  load:(artifact,file)=>JSON.parse(readFileSync(reports.get(artifact+'/'+file),'utf8')),
  change:(artifact,file,mutate)=>{
   const path=reports.get(artifact+'/'+file);
   const data=JSON.parse(readFileSync(path,'utf8'));
   mutate(data);
   writeFileSync(path,JSON.stringify(data));
  },
  dispose:()=>rmSync(directory,{recursive:true,force:true})
 };
}
const local=version=>['mysql-version-'+version+'-'+runId,'benchmark-local-'+runId+'-100.json'];
const tls=version=>['mysql-tls-version-'+version+'-'+runId,'benchmark-tls-'+runId+'-300.json'];
const soak=version=>['mysql-version-'+version+'-'+runId,'soak-local-'+runId+'-200.json'];
const restart=version=>['mysql-version-'+version+'-'+runId,'mysql-restart-'+version+'-'+runId+'.json'];

test('a complete same-revision pinned MySQL matrix produces a redacted approval summary',()=>{
 const x=fixture();
 try{
  const result=validateMatrixEvidence({...context,directory:x.directory});
  assert.equal(result.status,'passed');
  assert.equal(result.artifactGroups,4);
  assert.equal(result.validatedReports,8);
  assert.deepEqual(result.validated.map(x=>x.mysqlVersion),versions);
  assert.ok(!JSON.stringify(result).includes('password'));
 }finally{x.dispose();}
});

test('matrix approval requires exact commit and all four independently uploaded version groups',()=>{
 const x=fixture();
 try{
  assert.throws(()=>validateMatrixEvidence({...context,revision:'b'.repeat(40),directory:x.directory}),/revision mismatch/);
  assert.throws(()=>validateMatrixEvidence({...context,runId:'not-an-id',directory:x.directory}),/Numeric workflow run ID/);
  unlinkSync(x.reports.get(tls('8.0.44').join('/')));
  assert.throws(()=>validateMatrixEvidence({...context,directory:x.directory}),/Expected exactly one benchmark-tls/);
 }finally{x.dispose();}
});

test('duplicate and wrong-version reports cannot satisfy compatibility evidence',()=>{
 const x=fixture();
 try{
  const [folder,file]=local('8.4.11');
  x.change(folder,file,report=>{report.environment.serverVersion='8.0.44';});
  assert.throws(()=>validateMatrixEvidence({...context,directory:x.directory}),/Environment or revision mismatch/);
  x.change(folder,file,report=>{report.environment.serverVersion='8.4.11';});
  writeFileSync(join(x.directory,folder,'benchmark-local-'+runId+'-999.json'),
   JSON.stringify(x.load(folder,file)));
  assert.throws(()=>validateMatrixEvidence({...context,directory:x.directory}),/exactly one/);
 }finally{x.dispose();}
});

test('report errors, TLS missing negative authentication and resource leaks fail the evidence gate',()=>{
 for(const mutation of [
  report=>{report.errors.unexpected=1;},
  report=>{report.workloads.rejectedAuthentication.count=0;},
  report=>{report.resources.poolAfterClose.size=1;}
 ]){
  const x=fixture();
  try{
   x.change(...tls('8.0.44'),mutation);
   assert.throws(()=>validateMatrixEvidence({...context,directory:x.directory}));
  }finally{x.dispose();}
 }
});

test('short soaks, missing error recovery and a failed restart cannot pass',()=>{
 for(const [fileFor,mutation] of [
  [soak,report=>{report.workloads.pool.elapsedMs=4999;}],
  [soak,report=>{report.errors.expectedSqlErrors=0;}],
  [restart,report=>{report.recovery.poolReconnected=false;}],
  [restart,report=>{report.resources.poolClosed.size=1;}]
 ]){
  const x=fixture();
  try{
   x.change(...fileFor('8.0.44'),mutation);
   assert.throws(()=>validateMatrixEvidence({...context,directory:x.directory}));
  }finally{x.dispose();}
 }
});

test('scheduled two-minute matrix requires actual 120-second soak evidence',()=>{
 const x=fixture();
 try{
  assert.throws(()=>validateMatrixEvidence({...context,eventName:'schedule',directory:x.directory}),/Incomplete sustained-duration/);
  for(const v of versions)x.change(...soak(v),r=>{r.workloads.pool.elapsedMs=120100;});
  assert.equal(validateMatrixEvidence({...context,eventName:'schedule',directory:x.directory}).status,'passed');
 }finally{x.dispose();}
});

test('current-release matrix requires all three local profiles and both LTS TLS profiles',()=>{
 const x=fixture('current');
 try{
  const result=validateMatrixEvidence({...context,directory:x.directory,profile:'current'});
  assert.equal(result.status,'passed');
  assert.equal(result.artifactGroups,5);
  assert.equal(result.validatedReports,11);
  assert.deepEqual(result.validated.map(x=>x.mysqlVersion),['8.4.13','9.7.4','26.10.0']);
  assert.deepEqual(result.validated.map(x=>x.verifiedTls),['passed','passed','not-qualified']);
  assert.ok(!JSON.stringify(result).includes('password'));
 }finally{x.dispose();}
});

test('current matrix must not silently approve absent LTS TLS or a failed Innovation restart',()=>{
 for(const failure of ['tls','restart','revision','soak']){
  const x=fixture('current');
  try{
   if(failure==='tls')
    unlinkSync(x.reports.get('mysql-current-tls-9.7.4-'+runId+
      '/benchmark-tls-'+runId+'-300.json'));
   if(failure==='restart')
    x.change('mysql-current-release-26.10.0-'+runId,
      'mysql-restart-26.10.0-'+runId+'.json',report=>{
       report.recovery.poolReconnected=false;
      });
   if(failure==='revision')
    x.change('mysql-current-tls-8.4.13-'+runId,
      'benchmark-tls-'+runId+'-300.json',report=>{
       report.environment.revision='f'.repeat(40);
      });
   if(failure==='soak')
    x.change('mysql-current-release-9.7.4-'+runId,
      'soak-local-'+runId+'-200.json',report=>{
       report.workloads.pool.elapsedMs=4999;
      });
   assert.throws(()=>validateMatrixEvidence({...context,directory:x.directory,
    profile:'current'}),'Expected current matrix to reject '+failure);
  }finally{x.dispose();}
 }
});

test('the current matrix cannot be substituted for legacy or scheduled evidence',()=>{
 const x=fixture('current');
 try{
  assert.throws(()=>validateMatrixEvidence({...context,directory:x.directory}),
    /Expected exactly one/);
  assert.throws(()=>validateMatrixEvidence({...context,directory:x.directory,
    profile:'unrecognised'}),/Unsupported qualification matrix profile/);
  assert.throws(()=>validateMatrixEvidence({...context,directory:x.directory,
    eventName:'schedule',profile:'current'}),/Incomplete sustained-duration/);
  for(const v of ['8.4.13','9.7.4','26.10.0']){
   x.change('mysql-current-release-'+v+'-'+runId,
    'soak-local-'+runId+'-200.json',r=>{r.workloads.pool.elapsedMs=120100;});
  }
  assert.equal(validateMatrixEvidence({...context,directory:x.directory,
   eventName:'schedule',profile:'current'}).status,'passed');
 }finally{x.dispose();}
});
