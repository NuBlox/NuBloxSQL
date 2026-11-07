/**
 * Actual native MySQL query-result retention profiling. A connection remains
 * open outside each measurement, with the returned QueryResult held through
 * an explicit GC snapshot. No credentials, SQL or values enter the report.
 * Diagnostic evidence only; not per-query allocation attribution.
 */
import {performance} from 'node:perf_hooks';
import {MysqlMaterializationBudget} from
  '../../packages/driver/dist/vendors/mysql/materialization.js';
import {columnKeys} from '../../packages/driver/dist/vendors/mysql/types.js';

const memoryKeys=['heapUsed','rss','external','arrayBuffers'];
const ranges={rows:[20,500,250],rowBytes:[256,4096,2048],
  rounds:[2,4,3]};

export function liveRetentionOptions(raw={}){
  if(raw===null||typeof raw!=='object'||Array.isArray(raw)||
     Object.keys(raw).some(key=>!Object.hasOwn(ranges,key)))
    throw new TypeError('Invalid live retention profile options');
  const options={};
  for(const [key,[min,max,fallback]] of Object.entries(ranges)){
    const value=raw[key]??fallback;
    if(!Number.isSafeInteger(value)||value<min||value>max)
      throw new RangeError('Invalid live retention profile '+key);
    options[key]=value;
  }
  if(options.rows*options.rowBytes*2>8*1024*1024)
    throw new RangeError('Live retention workload exceeds 8 MiB selected payload');
  return Object.freeze(options);
}

const textAndBlobSql=`SELECT a.n+10*b.n+100*c.n AS ordinal,
 REPEAT('x', ?) AS text_value,
 CAST(REPEAT('y', ?) AS BINARY) AS binary_value
 FROM (SELECT 0 n UNION ALL SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL
       SELECT 4 UNION ALL SELECT 5 UNION ALL SELECT 6 UNION ALL SELECT 7 UNION ALL
       SELECT 8 UNION ALL SELECT 9) a
 JOIN (SELECT 0 n UNION ALL SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL
       SELECT 4 UNION ALL SELECT 5 UNION ALL SELECT 6 UNION ALL SELECT 7 UNION ALL
       SELECT 8 UNION ALL SELECT 9) b
 JOIN (SELECT 0 n UNION ALL SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL
       SELECT 4 UNION ALL SELECT 5 UNION ALL SELECT 6 UNION ALL SELECT 7 UNION ALL
       SELECT 8 UNION ALL SELECT 9) c
 WHERE a.n+10*b.n+100*c.n < ? ORDER BY ordinal`;

function snapshot(memoryUsage){
  const source=memoryUsage();
  const result={};
  for(const key of memoryKeys){
    const value=source?.[key];
    if(!Number.isSafeInteger(value)||value<0)
      throw new Error('Invalid live retention memory measurement');
    result[key]=value;
  }
  return result;
}

function validateTextAndBlob(result,options){
  if(!result||result.rows?.length!==options.rows||
     result.rowValues?.length!==options.rows||
     result.columns?.length!==3)
    throw new Error('Invalid live retention text/BLOB result shape');
  for(let i=0;i<options.rows;i++){
    const row=result.rows[i],values=result.rowValues[i];
    if(!row||!Array.isArray(values)||values.length!==3||
       Number(row.ordinal)!==i||typeof row.text_value!=='string'||
       row.text_value.length!==options.rowBytes||
       row.text_value[0]!=='x'||row.text_value.at(-1)!=='x'||
       !Buffer.isBuffer(row.binary_value)||
       row.binary_value.length!==options.rowBytes||
       row.binary_value[0]!==0x79||
       row.binary_value.at(-1)!==0x79||
       values[0]!==row.ordinal||values[1]!==row.text_value||
       values[2]!==row.binary_value)
      throw new Error('Invalid live retention text/BLOB row');
  }
}

function validateMultiResults(sets){
  if(!Array.isArray(sets)||sets.length!==3||
     sets[0]?.rows?.length!==1||sets[1]?.rows?.length!==1||
     sets[2]?.rows?.length!==0||
     sets[0].rows[0].initial_value!==41n||
     sets[0].rows[0].label!=='first'||
     sets[1].rows[0].second_value!==42n)
    throw new Error('Invalid live retention multi-result response');
}

function estimateResults(sets){
  const budget=new MysqlMaterializationBudget();
  for(const set of sets){
    const columns=set.columns;
    if(!Array.isArray(columns)||columns.length===0)continue;
    const keys=set.columnKeys??columnKeys(columns);
    if(!Array.isArray(keys)||keys.length!==columns.length||
       !Array.isArray(set.rowValues)||set.rowValues.length!==set.rows?.length)
      throw new Error('Incomplete live retention column or positional data');
    budget.columns(columns,keys);
    for(const values of set.rowValues){
      if(!Array.isArray(values)||values.length!==columns.length)
        throw new Error('Invalid live retention positional row');
      budget.beforeRow(columns.length);
      budget.decoded(values);
    }
  }
  return budget.estimatedBytes;
}

/** Run in one isolated MySQL fixture session, not concurrently with other
 * measured work; a successful query is retained across its after-GC sample. */
export async function profileLiveRetention({
  connect,target,options={},gc=global.gc,memoryUsage=process.memoryUsage,
  now=()=>performance.now()
}={}){
  const config=liveRetentionOptions(options);
  if(typeof connect!=='function'||!target||
     typeof gc!=='function'||typeof memoryUsage!=='function'||
     typeof now!=='function')
    throw new Error('Live retention profile requires connection and --expose-gc');
  const scenarios=[
    {name:'textBlobRows',run:db=>db.query(textAndBlobSql,
      [config.rowBytes,config.rowBytes,config.rows]),
    verify:r=>validateTextAndBlob(r,config),
    expectedPayloadBytes:config.rows*config.rowBytes*2},
    {name:'storedProcedureMultiResult',run:db=>
      db.queryResults('CALL nublox_multi_result(?)',[41]),
    verify:validateMultiResults,expectedPayloadBytes:0}
  ];
  const samples=[];
  let serverVersion=null;
  const db=await connect(target);
  try{
    if(typeof db?.query!=='function'||typeof db.queryResults!=='function'||
       typeof db.close!=='function'||typeof db.info?.version!=='string')
      throw new Error('Invalid live retention database connection');
    serverVersion=db.info.version;
    // Warmup is explicitly outside samples; validate the real wire outputs.
    for(const scenario of scenarios){
      const result=await scenario.run(db);
      scenario.verify(result);
    }
    gc();
    for(let round=1;round<=config.rounds;round++){
      for(let offset=0;offset<scenarios.length;offset++){
        const scenario=scenarios[(round-1+offset)%scenarios.length];
        gc();
        const before=snapshot(memoryUsage),start=now();
        const held=await scenario.run(db);
        scenario.verify(held);
        gc();
        const after=snapshot(memoryUsage),elapsedMs=now()-start;
        if(!Number.isFinite(elapsedMs)||elapsedMs<0)
          throw new Error('Invalid live retention duration');
        const sets=Array.isArray(held)?held:[held];
        const estimatedRetainedBytes=estimateResults(sets);
        const totalRows=sets.reduce((sum,set)=>sum+set.rows.length,0);
        const totalCells=sets.reduce(
          (sum,set)=>sum+set.rows.length*set.columns.length,0);
        samples.push({
          scenario:scenario.name,round,resultSets:sets.length,
          rows:totalRows,cells:totalCells,
          expectedPayloadBytes:scenario.expectedPayloadBytes,
          estimatedRetainedBytes,
          elapsedMs:Number(elapsedMs.toFixed(3)),
          before,after,
          deltaBytes:Object.fromEntries(memoryKeys.map(key=>[
            key,after[key]-before[key]
          ]))
        });
        // All result data goes out of scope between scenarios; the next GC
        // intentionally measures a new retained execution, not cumulative
        // allocations or an unbounded query-result cache.
      }
    }
    return {
      schemaVersion:1,kind:'mysql-live-result-retention-profile',
      serverVersion,options:config,samples,
      measurement:'forced GC before and after retaining real query results',
      limitations:[
        'Process memory deltas are not attributable exclusively to QueryResult allocations',
        'Heap, RSS, external and ArrayBuffer memory overlap and must not be added',
        'GC and network buffers introduce noise even with a live isolated server',
        'Fixture stored procedure returns two small sets and one terminal status',
        'Measured estimates and durations are diagnostic, not production release gates'
      ]
    };
  }finally{await db.close();}
}
