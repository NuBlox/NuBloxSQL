/**
 * Cross-run evidence only. Paired-round variance and bootstraps are owned by
 * analyse.mjs (PR #391); do not duplicate that within-run implementation.
 * Group by independent report, not by correlated SQL or round samples.
 */
import {analyseComparison} from './analyse.mjs';
import {COMPARISON_WORKLOADS} from './core.mjs';

const round=n=>Math.round(n*1e6)/1e6;
const fail=()=>{throw Error('Invalid or incomparable MySQL performance evidence');};
const positive=n=>typeof n==='number'&&Number.isFinite(n)&&n>0;

function distribution(values){
  if(!values.length||values.some(v=>!positive(v)))fail();
  const sorted=[...values].sort((a,b)=>a-b);
  const mean=values.reduce((sum,n)=>sum+n,0)/values.length;
  const variance=values.reduce((sum,n)=>sum+(n-mean)**2,0)/values.length;
  return Object.freeze({
    count:values.length,
    geometricMean:round(Math.exp(values.reduce((sum,v)=>sum+Math.log(v),0)/values.length)),
    median:round(sorted.length%2?sorted[Math.floor(sorted.length/2)]
      :(sorted[sorted.length/2-1]+sorted[sorted.length/2])/2),
    min:round(sorted[0]),max:round(sorted.at(-1)),
    coefficientOfVariationPct:round(Math.sqrt(variance)/mean*100)
  });
}

// Exact two-sided binomial sign test on independent RUN-level directions,
// never on samples/rounds sharing the same process and MySQL instance.
function exactSignP(less,greater){
  const n=less+greater;
  if(!n)return null;
  const k=Math.min(less,greater);
  let combinations=1,total=1;
  for(let i=1;i<=k;i++){
    combinations=combinations*(n-i+1)/i;
    total+=combinations;
  }
  return Math.min(1,2*total/2**n);
}

const fingerprint=report=>JSON.stringify({
  revision:report.environment.revision??null,
  node:report.environment.node,
  platform:report.environment.platform,
  arch:report.environment.arch,
  cpuCount:report.environment.cpuCount,
  serverVersion:report.environment.serverVersion,
  transport:report.environment.transport,
  peerVersion:report.environment.peerVersion,
  iterations:report.configuration.iterations,
  concurrency:report.configuration.concurrency,
  rounds:report.configuration.rounds,
  preparedWarmupPerSession:report.configuration.preparedWarmupPerSession,
  ordering:report.configuration.ordering,
  workloads:report.configuration.workloads
});

export function analyzeReports(reports){
  if(!Array.isArray(reports)||reports.length<2||reports.length>64||
    !reports[0]?.environment||!reports[0]?.configuration)fail();
  const identity=fingerprint(reports[0]);
  const timestamps=new Set();
  const perRun=[];
  for(const report of reports){
    if(!report?.environment||!report?.configuration||report.schemaVersion!==1||
      report.kind!=='mysql-concurrent-prepared-comparison'||report.status!=='passed'||
      fingerprint(report)!==identity||
      typeof report.environment.timestamp!=='string'||
      !Number.isFinite(Date.parse(report.environment.timestamp))||
      timestamps.has(report.environment.timestamp)||
      !Number.isSafeInteger(report.configuration.rounds)||
      report.configuration.rounds<2||report.configuration.rounds>8||
      !Number.isSafeInteger(report.configuration.iterations)||
      report.configuration.iterations<4||report.configuration.iterations>2000||
      !Number.isSafeInteger(report.configuration.concurrency)||
      report.configuration.concurrency<1||report.configuration.concurrency>8)
      fail();
    timestamps.add(report.environment.timestamp);
    let analysis;
    try{
      analysis=analyseComparison(report.trials,{
        rounds:report.configuration.rounds,
        iterations:report.configuration.iterations
      });
    }catch{fail();}
    if(analysis.workloads.length!==COMPARISON_WORKLOADS.length)fail();
    const ratios=new Map();
    for(const workload of analysis.workloads){
      const ratio=workload.p50LatencyRatioNativeToMysql2.geometricMean;
      if(!COMPARISON_WORKLOADS.includes(workload.workload)||!positive(ratio)||
        ratios.has(workload.workload))fail();
      ratios.set(workload.workload,ratio);
    }
    perRun.push(ratios);
  }

  return Object.freeze({
    schemaVersion:1,
    kind:'mysql-concurrent-cross-run-analysis',
    repeatedRuns:reports.length,
    evidenceScope:'matched recorded configuration only; run independence and identical physical hosts are not independently verified',
    workloads:COMPARISON_WORKLOADS.map(workload=>{
      const ratios=perRun.map(run=>run.get(workload));
      const less=ratios.filter(x=>x<1).length;
      const greater=ratios.filter(x=>x>1).length;
      const ties=ratios.length-less-greater;
      const probability=exactSignP(less,greater);
      return Object.freeze({
        workload,
        nativeToMysql2P50RatioAcrossRuns:distribution(ratios),
        nativeLowerLatencyRuns:less,
        mysql2LowerLatencyRuns:greater,
        tiedRuns:ties,
        signTestTwoSidedP:probability===null?null:round(probability),
        evidence:ratios.length>=6&&less+greater>=6&&probability<.05
          ?'consistent-direction-in-this-environment':'inconclusive',
        note:'not a confidence interval or evidence of cross-platform superiority'
      });
    })
  });
}
