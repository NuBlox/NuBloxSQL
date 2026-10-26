/**
 * Paired, descriptive comparison analysis for the extended MySQL benchmark.
 * Ratio < 1 means NuBloxSQL's observed round latency was lower than mysql2's.
 * All timings are rounded by the measurement runner; this analysis is
 * deliberately not a statistically justified performance claim.
 *
 * No SQL, credentials, connection targets, error messages or row data here.
 */
import {COMPARISON_CLIENTS,COMPARISON_WORKLOADS} from './core.mjs';

const round=n=>Math.round(n*10000)/10000;
const median=values=>{
  const sorted=[...values].sort((a,b)=>a-b);
  const mid=Math.floor(sorted.length/2);
  return sorted.length%2 ? sorted[mid] : (sorted[mid-1]+sorted[mid])/2;
};
const geometricMean=values=>Math.exp(values.reduce((acc,n)=>acc+Math.log(n),0)/values.length);
const percentile=(sorted,p)=>sorted[Math.max(0,Math.ceil(sorted.length*p)-1)];

/** Fixed-seed bootstrap of whole paired rounds, rather than individual
 * operations. This respects the fact that intra-round timings are correlated.
 * Intervals with fewer than 6 rounds are withheld. Even with 6+ rounds,
 * intervals are exploratory; shared-runner drift violates ideal assumptions.
 */
function pairedBootstrap(ratios){
  let state=0x96c3a5e7;
  const random=()=>{
    state^=state<<13;
    state^=state>>>17;
    state^=state<<5;
    return (state>>>0)/0x100000000;
  };
  const n=ratios.length,draws=[];
  for(let i=0;i<4096;i++){
    let sum=0;
    for(let j=0;j<n;j++)sum+=Math.log(ratios[Math.floor(random()*n)]);
    draws.push(Math.exp(sum/n));
  }
  draws.sort((a,b)=>a-b);
  return Object.freeze({
    lower:round(percentile(draws,0.025)),
    upper:round(percentile(draws,0.975)),
    level:0.95,
    method:'fixed-seed paired-round bootstrap',
    resamples:4096,
    interpretation:'exploratory, not a validated performance guarantee'
  });
}

function assertRow(row,rounds,iterations){
  if(!row||!Number.isSafeInteger(row.round)||row.round<1||row.round>rounds||
    !COMPARISON_WORKLOADS.includes(row.workload)||
    !COMPARISON_CLIENTS.includes(row.client)||
    row.count!==iterations||
    !Number.isFinite(row.p50Ms)||row.p50Ms<=0||
    !Number.isFinite(row.p95Ms)||row.p95Ms<=0||
    !Number.isFinite(row.elapsedMs)||row.elapsedMs<=0)
    throw Error('Invalid or incomplete comparison round');
}

/** Validate complete paired evidence and summarize run-to-run dispersion.
 * Do not pool all latency samples across clients or treat individual queries
 * as independent experiments. Per-round order effects remain visible.
 */
export function analyseComparison(trials,{rounds,iterations}){
  if(!Array.isArray(trials)||!Number.isSafeInteger(rounds)||
    rounds<2||rounds>8||!Number.isSafeInteger(iterations)||
    iterations<4||iterations>2000||
    trials.length!==COMPARISON_WORKLOADS.length*COMPARISON_CLIENTS.length*rounds)
    throw Error('Incomplete paired comparison evidence');

  const keyed=new Map();
  for(const trial of trials){
    assertRow(trial,rounds,iterations);
    const key=`${trial.workload}:${trial.round}:${trial.client}`;
    if(keyed.has(key))throw Error('Duplicate comparison round');
    keyed.set(key,trial);
  }

  const analyses=[];
  for(const workload of COMPARISON_WORKLOADS){
    const pairs=[];
    for(let number=1;number<=rounds;number++){
      const native=keyed.get(`${workload}:${number}:nubloxsql`);
      const peer=keyed.get(`${workload}:${number}:mysql2`);
      if(!native||!peer)throw Error('Missing paired comparison round');
      pairs.push({
        round:number,
        firstClient:number%2?'nubloxsql':'mysql2',
        nativeP50Ms:native.p50Ms,
        peerP50Ms:peer.p50Ms,
        nativeP95Ms:native.p95Ms,
        peerP95Ms:peer.p95Ms,
        p50LatencyRatio:native.p50Ms/peer.p50Ms,
        p95LatencyRatio:native.p95Ms/peer.p95Ms
      });
    }
    const ratios=pairs.map(p=>p.p50LatencyRatio);
    const mean=ratios.reduce((a,b)=>a+b,0)/rounds;
    const sd=Math.sqrt(ratios.reduce((sum,x)=>sum+(x-mean)**2,0)/(rounds-1));
    const first=geometricMean(pairs.filter(p=>p.firstClient==='nubloxsql')
      .map(p=>p.p50LatencyRatio));
    const second=geometricMean(pairs.filter(p=>p.firstClient==='mysql2')
      .map(p=>p.p50LatencyRatio));
    analyses.push(Object.freeze({
      workload,roundCount:rounds,
      p50LatencyRatioNativeToMysql2:{
        median:round(median(ratios)),
        geometricMean:round(geometricMean(ratios)),
        min:round(Math.min(...ratios)),
        max:round(Math.max(...ratios)),
        coefficientOfVariation:round(sd/mean),
        roundsWithLowerNativeLatency:ratios.filter(x=>x<1).length,
        roundsWithLowerPeerLatency:ratios.filter(x=>x>1).length,
        orderStrata:{
          nativeFirstGeometricMean:round(first),
          mysql2FirstGeometricMean:round(second)
        },
        exploratory95Interval:rounds>=6?pairedBootstrap(ratios):null
      },
      perRound:pairs.map(p=>Object.freeze({
        round:p.round,firstClient:p.firstClient,
        nativeP50Ms:p.nativeP50Ms,peerP50Ms:p.peerP50Ms,
        p50LatencyRatio:round(p.p50LatencyRatio),
        p95LatencyRatio:round(p.p95LatencyRatio)
      }))
    }));
  }
  return Object.freeze({
    schemaVersion:1,
    measure:'native round median latency / mysql2 round median latency',
    direction:'ratio < 1: NuBloxSQL lower latency; ratio > 1: mysql2 lower latency',
    pairing:'same workload, MySQL instance and numbered round',
    independentUnit:'benchmark round (not individual SQL operations)',
    levelOfEvidence:rounds>=6?'exploratory':'insufficient-for-interval',
    caveat:'Shared CI host, small round count and unmeasured confounders prevent definitive performance claims.',
    workloads:analyses
  });
}
