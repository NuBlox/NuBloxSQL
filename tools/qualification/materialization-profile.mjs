/**
 * GC-controlled synthetic retained-result memory profile for the native
 * MySQL binary decoder. Not a live query, a heap limit or release sign-off.
 */
import {binaryValues,columnKeys,objectRow} from '../../packages/driver/dist/vendors/mysql/types.js';
import {MysqlMaterializationBudget} from '../../packages/driver/dist/vendors/mysql/materialization.js';
import {T,sized} from '../../packages/driver/dist/vendors/mysql/protocol/primitives.js';

const METRICS=Object.freeze(['heapUsed','rss','external','arrayBuffers']);

function boundedInteger(value,min,max,label){
  if(!Number.isSafeInteger(value)||value<min||value>max)
    throw new RangeError('Invalid materialization profile '+label);
  return value;
}

export function materializationProfileOptions(raw={}){
  if(!raw||typeof raw!=='object'||Array.isArray(raw))
    throw new TypeError('Invalid materialization profile options');
  return Object.freeze({
    rows:boundedInteger(raw.rows??250,20,1000,'rows'),
    rounds:boundedInteger(raw.rounds??3,2,6,'rounds'),
    textBytes:boundedInteger(raw.textBytes??2048,16,4096,'textBytes')
  });
}

const column=(i,type,charset)=>({
  name:'c'+i,schema:'',table:'',originalName:'',originalTable:'',
  charset,length:4096,type,flags:0,decimals:0,unsigned:false
});

function fixtures(textBytes){
  const numericCols=Array.from({length:8},(_,i)=>column(i,T.LONGLONG,63));
  const numericCells=numericCols.map((_,i)=>{
    const b=Buffer.alloc(8);b.writeBigInt64LE(BigInt(i+1));return b;
  });
  const nullCols=Array.from({length:64},(_,i)=>column(i,T.TINY,63));
  const nullBitmap=Buffer.alloc(Math.ceil((nullCols.length+2)/8),0xff);
  nullBitmap[0]&=0xfc; // two reserved leading bits
  const mixedCols=Array.from({length:8},(_,i)=>column(i,
    i%2===0?T.VAR_STRING:T.BLOB,i%2===0?45:63));
  const mixedCells=mixedCols.map((_,i)=>sized(i%2===0
    ?Buffer.from('x'.repeat(textBytes))
    :Buffer.alloc(textBytes,0x55)));
  return [
    {name:'numeric8',columns:numericCols,
      packet:Buffer.concat([Buffer.from([0,0,0]),...numericCells])},
    {name:'nullable64',columns:nullCols,
      packet:Buffer.concat([Buffer.from([0]),nullBitmap])},
    {name:'textBinary8',columns:mixedCols,
      packet:Buffer.concat([Buffer.from([0,0,0]),...mixedCells])}
  ];
}

function snapshot(memoryUsage){
  const current=memoryUsage();
  const result={};
  for(const name of METRICS){
    const value=current?.[name];
    if(!Number.isSafeInteger(value)||value<0)
      throw new Error('Invalid process memory measurement: '+name);
    result[name]=value;
  }
  return result;
}

function differences(after,before){
  return Object.fromEntries(METRICS.map(key=>[key,after[key]-before[key]]));
}

/** Descriptive cross-round calibration, not a heap guarantee or CI gate.
 * All process memory quantities remain separate; they overlap and must
 * never be added as though they represent distinct retained allocations. */
export function summarizeMaterializationSamples(samples){
  if(!Array.isArray(samples)||!samples.length)
    throw new Error('Missing materialization profile samples');
  const scenarios=['numeric8','nullable64','textBinary8'];
  if(samples.length%scenarios.length!==0)
    throw new Error('Incomplete materialization profile rounds');
  const median=values=>{
    const sorted=[...values].sort((a,b)=>a-b);
    const middle=Math.floor(sorted.length/2);
    return sorted.length%2?sorted[middle]:
      (sorted[middle-1]+sorted[middle])/2;
  };
  return scenarios.map(scenario=>{
    const observations=samples.filter(sample=>sample?.scenario===scenario);
    if(observations.length<2||
       observations.length!==samples.length/scenarios.length)
      throw new Error('Incomplete materialization profile scenario '+scenario);
    const representative=observations[0];
    if(!Number.isSafeInteger(representative.estimatedRetainedBytes)||
       representative.estimatedRetainedBytes<=0||
       !Number.isSafeInteger(representative.rows)||representative.rows<1)
      throw new Error('Invalid materialization profile estimate');
    for(const sample of observations){
      if(sample.rows!==representative.rows||
         sample.columns!==representative.columns||
         sample.estimatedRetainedBytes!==representative.estimatedRetainedBytes||
         !Number.isSafeInteger(sample.round)||sample.round<1)
        throw new Error('Incomparable materialization profile samples');
    }
    if(new Set(observations.map(sample=>sample.round)).size!==observations.length)
      throw new Error('Duplicate materialization profile rounds');
    const measurement={};
    for(const name of METRICS){
      const values=observations.map(sample=>sample.deltaBytes?.[name]);
      if(values.some(value=>!Number.isSafeInteger(value)))
        throw new Error('Invalid materialization profile memory delta');
      measurement[name]={
        minDeltaBytes:Math.min(...values),
        medianDeltaBytes:median(values),
        maxDeltaBytes:Math.max(...values)
      };
    }
    return {
      scenario,rounds:observations.length,rows:representative.rows,
      columns:representative.columns,
      estimatedRetainedBytes:representative.estimatedRetainedBytes,
      measuredDeltaBytes:measurement,
      medianHeapToEstimateRatio:Number(
        (measurement.heapUsed.medianDeltaBytes/
          representative.estimatedRetainedBytes).toFixed(4))
    };
  });
}

/** Measurements are only meaningful when gc is a real forced full collection.
 * Injected sampling functions allow deterministic contract tests. */
export function profileMaterialization({
  options={},gc=global.gc,memoryUsage=process.memoryUsage
}={}){
  const config=materializationProfileOptions(options);
  if(typeof gc!=='function'||typeof memoryUsage!=='function')
    throw new Error('Materialization profile requires --expose-gc');
  const cases=fixtures(config.textBytes);
  const samples=[];
  for(let round=1;round<=config.rounds;round++){
    const ordered=cases.map((_,i)=>cases[(i+round-1)%cases.length]);
    for(const scenario of ordered){
      const keys=columnKeys(scenario.columns);
      const budget=new MysqlMaterializationBudget();
      // Prepare the fixture outside the observed retained-result interval.
      gc();
      const before=snapshot(memoryUsage);
      const retained={rows:[],rowValues:[]};
      budget.columns(scenario.columns,keys);
      for(let i=0;i<config.rows;i++){
        // A separate packet per row mirrors the transport's packet ownership:
        // binary Buffer views can pin their originating row packet.
        const packet=Buffer.from(scenario.packet);
        budget.beforeRow(scenario.columns.length);
        const values=binaryValues(packet,scenario.columns);
        budget.decoded(values);
        retained.rowValues.push(values);
        retained.rows.push(objectRow(values,keys));
      }
      gc();
      const after=snapshot(memoryUsage);
      // Read the retained result *after* measurement so it cannot be elided.
      const materializedCells=retained.rows.reduce(
        (sum,row)=>sum+Object.keys(row).length,0);
      if(materializedCells!==config.rows*scenario.columns.length||
         retained.rowValues.length!==config.rows)
        throw new Error('Materialization benchmark lost retained results');
      samples.push({
        scenario:scenario.name,round,rows:config.rows,
        columns:scenario.columns.length,cells:materializedCells,
        logicalWireRowBytes:scenario.packet.length,
        estimatedRetainedBytes:budget.estimatedBytes,
        before,after,deltaBytes:differences(after,before)
      });
      retained.rows.length=0;
      retained.rowValues.length=0;
      gc();
    }
  }
  return {
    schemaVersion:1,kind:'mysql-materialized-memory-profile',
    isolation:'synthetic native binary row decode, without MySQL server or network',
    measurement:'forced GC before and after retaining both result representations',
    units:'bytes',
    options:config,samples,
    calibrationSummary:summarizeMaterializationSamples(samples),
    limitations:[
      'V8 heap, RSS and Buffer/external memory are overlapping metrics; never sum them',
      'RSS and heap delta may be negative or noisy across rounds and runtimes',
      'Generated packet ownership and GC behavior approximate, not reproduce, real query execution',
      'Estimated retained bytes are an operational safeguard, not measured allocation size',
      'No fixed memory-ratio release threshold, vendor comparison or production performance claim'
    ]
  };
}
