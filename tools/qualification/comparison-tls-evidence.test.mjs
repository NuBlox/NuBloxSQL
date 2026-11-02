import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validateTlsComparisonReports,selectTlsComparisonReports}
  from './comparison/tls-evidence.mjs';
import {EXPECTED_TLS_CHECKS} from './comparison/tls-profile.mjs';
const revision='a'.repeat(40),runId='12345';
const workloads=['connectionOnly','preparedSequential','preparedConcurrent'];
function report(number,{ratio=0.8}={}){
  const trials=[];
  for(let round=1;round<=2;round++)for(const workload of workloads)
    for(const client of ['nubloxsql','mysql2']){
      const p50Ms=client==='nubloxsql'?ratio:1;
      trials.push({round,workload,client,count:12,p50Ms,
        p95Ms:p50Ms*2,operationsPerSecond:12,elapsedMs:1000});
    }
  return {
    schemaVersion:1,kind:'mysql-concurrent-prepared-comparison',status:'passed',
    environment:{
      revision,runId,ci:true,platform:'linux',arch:'x64',
      node:'v22.20.0',cpuCount:4,
      timestamp:new Date(Date.UTC(2026,10,2,1,number)).toISOString(),
      transport:'verified-tls',tlsChecks:{...EXPECTED_TLS_CHECKS},
      serverVersion:'8.4.13',peerVersion:'3.24.6'
    },
    configuration:{
      iterations:12,concurrency:2,rounds:2,preparedWarmupPerSession:8,
      ordering:'alternating by round',workloads
    },
    trials,errors:{codes:[]}
  };
}
const context={revision,runId};
test('TLS comparisons must match pinned run and remain inconclusive',()=>{
  const result=validateTlsComparisonReports([report(1),report(2)],context);
  assert.equal(result.status,'passed');
  assert.equal(result.transport,'verified-tls');
  assert.equal(result.workloads.length,3);
  assert.ok(result.workloads.every(x=>x.conclusion==='inconclusive'));
  const names=['comparison-concurrent-tls-12345-1799999999999.json',
    'comparison-concurrent-tls-12345-1799999999998.json'];
  assert.equal(selectTlsComparisonReports(names,runId).length,2);
});
test('reject forged identity and transport, incomplete trials and mixed-profile reports',()=>{
  const mutations=[
    r=>{r.status='running';},
    r=>{r.environment.revision='b'.repeat(40);},
    r=>{r.environment.runId='54321';},
    r=>{r.environment.node='v24.0.0';},
    r=>{r.environment.platform='darwin';},
    r=>{r.environment.serverVersion='8.4.11';},
    r=>{r.environment.peerVersion='3.24.5';},
    r=>{r.environment.transport='isolated-local';},
    r=>{r.environment.tlsChecks.nativeUnrelatedCaRejected=false;},
    r=>{r.environment.tlsChecks.mysql2IdentityVerified=false;},
    r=>{r.configuration.iterations=6;},
    r=>{r.configuration.concurrency=1;},
    r=>{r.trials.pop();},
    r=>{r.trials[0].p50Ms=0;},
    r=>{r.errors.codes.push('CONNECTION_FAILED');}
  ];
  for(const change of mutations){
    const a=report(1),b=report(2);
    change(b);
    assert.throws(()=>validateTlsComparisonReports([a,b],context));
  }
  assert.throws(()=>validateTlsComparisonReports([report(1)],context));
  assert.throws(()=>validateTlsComparisonReports([report(1),report(1)],context));
  for(const list of [[],['other.json'],
    ['comparison-concurrent-12345-1799999999999.json',
      'comparison-concurrent-tls-12345-1799999999998.json'],
    ['comparison-concurrent-tls-12345-1799999999999.json',
      'comparison-concurrent-tls-12345-1799999999999.json']])
    assert.throws(()=>selectTlsComparisonReports(list,runId));
});
