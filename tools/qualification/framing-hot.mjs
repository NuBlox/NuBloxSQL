import {EventEmitter} from 'node:events';
import {performance} from 'node:perf_hooks';

const median=values=>{
  const sorted=[...values].sort((a,b)=>a-b);
  const middle=Math.floor(sorted.length/2);
  return sorted.length%2?sorted[middle]:(sorted[middle-1]+sorted[middle])/2;
};
const round=n=>Math.round(n*10000)/10000;
function positiveInteger(value,name,min,max){
  if(!Number.isSafeInteger(value)||value<min||value>max)
    throw Error('Invalid framing profile '+name);
  return value;
}
function fixture(packetCount){
  // 8 bytes of payload are enough to exercise header parsing and the
  // zero-copy subarray buffer ownership path, without allocating during timing.
  const fragments=[];
  for(let i=0;i<packetCount;i++)
    fragments.push(Buffer.from([8,0,0,i&255,i&255,(i>>8)&255,0xa5,0x55,0,1,2,3]));
  return Buffer.concat(fragments);
}
class FakeSocket extends EventEmitter {
  destroy(){this.emit('close');}
}

/** Profile the synchronous framing hot path independently of read-await cost.
 * Reads verify every packet and drain queues outside the measured interval.
 * No physical network or MySQL server is involved.
 */
export async function profilePacketHeaders(PacketStream,{
  iterations=500,rounds=6,packetCount=256,now=()=>performance.now()
}={}){
  positiveInteger(iterations,'iterations',8,2000);
  positiveInteger(rounds,'rounds',2,8);
  positiveInteger(packetCount,'packetCount',8,512);
  if(typeof PacketStream!=='function'||typeof now!=='function')
    throw Error('Invalid MySQL frame profiler arguments');

  const chunk=fixture(packetCount);
  const samples=[];
  for(let roundNumber=1;roundNumber<=rounds;roundNumber++){
    const socket=new FakeSocket();
    const stream=new PacketStream(socket);
    const measured=[];
    try{
      for(let sample=0;sample<iterations+20;sample++){
        const start=now();
        socket.emit('data',chunk);
        const duration=now()-start;
        if(duration<=0||!Number.isFinite(duration))
          throw Error('Invalid packet framing duration');
        // Drain and validate exactly the same work for each implementation.
        for(let i=0;i<packetCount;i++){
          const data=await stream.read();
          if(data.length!==8||data[0]!== (i&255)||
            data[1]!== ((i>>8)&255)||data[2]!==0xa5)
            throw Error('MySQL packet header profile failed payload integrity');
        }
        stream.reset();
        if(sample>=20)measured.push(duration);
      }
      const p50Ms=median(measured);
      samples.push(Object.freeze({
        round:roundNumber,packetCount,iterations,p50Ms:round(p50Ms),
        p50FramesPerSecond:round(packetCount*1000/p50Ms)
      }));
    }finally{stream.destroy();}
  }
  return Object.freeze(samples);
}

/** Exactly four reports, B-A-A-B, same packet count and iteration count.
 * A descriptive throughput ratio is not a statistically established speedup.
 */
export function comparePacketHeaderProfiles(reports,{baselineRevision,candidateRevision}){
  if(!Array.isArray(reports)||reports.length!==4||!baselineRevision||
    !candidateRevision||baselineRevision===candidateRevision)
    throw Error('Invalid packet header comparison inputs');
  const expected=JSON.stringify(reports[0].map(x=>[x.round,x.packetCount,x.iterations]));
  for(const report of reports){
    if(!Array.isArray(report)||report.length<2||report.length>8||
      JSON.stringify(report.map(x=>[x.round,x.packetCount,x.iterations]))!==expected||
      report.some(x=>!Number.isFinite(x.p50FramesPerSecond)||x.p50FramesPerSecond<=0))
      throw Error('Mismatched or malformed packet header profiles');
  }
  const base=median([...reports[0],...reports[3]].map(x=>x.p50FramesPerSecond));
  const candidate=median([...reports[1],...reports[2]].map(x=>x.p50FramesPerSecond));
  return Object.freeze({
    kind:'mysql-framing-hot-path-before-after',
    baselineRevision,candidateRevision,
    stage:'contiguous Classic frame headers delivered in one TCP data event',
    measures:'synchronous frame processing, excluding read/drain verification',
    packetsPerSample:reports[0][0].packetCount,
    samplesPerRound:reports[0][0].iterations,
    roundsPerRun:reports[0].length,
    runsOrder:['baseline','candidate','candidate','baseline'],
    baselineMedianFramesPerSecond:round(base),
    candidateMedianFramesPerSecond:round(candidate),
    candidateToBaselineRatio:round(candidate/base),
    caution:'Synthetic same-runner measurements only; no query latency or release speed guarantee'
  });
}
