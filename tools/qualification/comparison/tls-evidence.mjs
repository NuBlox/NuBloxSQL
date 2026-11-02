/**
 * Independent, fail-closed validation of two diagnostic MySQL8.4.13
 * verified-TLS comparisons. Never infer product superiority from CI data.
 */
import assert from 'node:assert/strict';
import {analyzeReports} from './cross-run.mjs';
import {EXPECTED_TLS_CHECKS} from './tls-profile.mjs';

export function selectTlsComparisonReports(names,runId){
  assert.match(runId??'',/^\d{1,15}$/);
  assert.ok(Array.isArray(names)&&names.every(n=>typeof n==='string'));
  const json=names.filter(n=>n.endsWith('.json')).sort();
  assert.equal(json.length,2,'Require exactly two original TLS comparisons');
  const regex=new RegExp('^comparison-concurrent-tls-'+runId+'-[0-9]{13}\\.json$');
  assert.ok(json.every(name=>regex.test(name))&&json[0]!==json[1],
    'Reports must be distinct and belong to this exact workflow run');
  return Object.freeze(json);
}

export function validateTlsComparisonReports(reports,{revision,runId}){
  assert.match(revision??'',/^[a-f0-9]{40}$/);
  assert.match(runId??'',/^\d{1,15}$/);
  assert.ok(Array.isArray(reports)&&reports.length===2,
    'Two original TLS comparisons required');
  for(const r of reports){
    assert.ok(r?.schemaVersion===1&&
      r.kind==='mysql-concurrent-prepared-comparison'&&r.status==='passed');
    const env=r.environment;
    assert.ok(env?.revision===revision&&env.runId===runId&&
      env.ci===true&&env.platform==='linux'&&env.arch==='x64'&&
      /^v22\./.test(env.node??'')&&
      env.transport==='verified-tls'&&
      /^8\.4\.13(?:[-+].*)?$/.test(env.serverVersion??'')&&
      env.peerVersion==='3.24.6','Exact TLS MySQL, Node and peer required');
    assert.deepEqual(env.tlsChecks,EXPECTED_TLS_CHECKS,
      'Both comparison peers must enforce identity and reject other CAs');
    assert.deepEqual(r.configuration,{
      iterations:12,concurrency:2,rounds:2,preparedWarmupPerSession:8,
      ordering:'alternating by round',
      workloads:['connectionOnly','preparedSequential','preparedConcurrent']
    },'Peer workload settings must be identical');
    assert.deepEqual(r.errors,{codes:[]},
      'Unexpected SQL or transport errors invalidate the comparison');
  }
  // Independently reconstruct all paired ratios and per-run distributions
  // from the original trials; untrusted embedded analysis is not evidence.
  const aggregate=analyzeReports(reports);
  assert.equal(aggregate.repeatedRuns,2);
  for(const w of aggregate.workloads){
    assert.equal(w.evidence,'inconclusive',
      'Shared-runner diagnostic results cannot certify superiority');
  }
  return Object.freeze({
    schemaVersion:1,kind:'mysql-verified-tls-comparison-evidence',
    status:'passed',revision,runId,
    serverVersion:'8.4.13',transport:'verified-tls',
    comparator:'mysql2@3.24.6',runCount:2,
    workloads:aggregate.workloads.map(w=>({
      name:w.workload,
      medianNativeToPeerP50Ratio:w.nativeToMysql2P50RatioAcrossRuns.median,
      conclusion:w.evidence
    })),
    limitation:'Shared CI hardware, two runs and a bound one-row SELECT cannot establish general relative performance.'
  });
}
