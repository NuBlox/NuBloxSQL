import {performance} from 'node:perf_hooks';
import {summarize,integerOption} from './metrics.mjs';

/** The comparison intentionally benchmarks the same *public behaviour*:
 * native connection establishment and repeated execution of one explicitly
 * prepared, bound, single-row SELECT. Pooling and implicit statement caches
 * are excluded because those have different semantics between clients.
 */
export function parseComparisonArgs(args){
  const allowed=new Set(['iterations','rounds','connections']);
  const values={};
  for(const arg of args){
    const match=/^--([a-z]+)=([0-9]+)$/.exec(arg);
    if(!match||!allowed.has(match[1])||Object.hasOwn(values,match[1]))
      throw Error('Unknown, duplicate or invalid comparison option');
    values[match[1]]=match[2];
  }
  return Object.freeze({
    iterations:integerOption(values.iterations??80,{name:'iterations',min:8,max:10000}),
    rounds:integerOption(values.rounds??4,{name:'rounds',min:2,max:12}),
    connections:integerOption(values.connections??8,{name:'connections',min:2,max:32})
  });
}

function assertValue(actual,expected){
  // The two clients deliberately expose BIGINTs differently. These small
  // positive bound integers are exactly representable as JS Numbers.
  if(typeof actual!=='number'&&typeof actual!=='bigint')
    throw Error('Comparable SELECT returned a nonnumeric value');
  if(Number(actual)!==expected)
    throw Error('Comparable SELECT returned an incorrect value');
}

export async function compareClients(clients,options){
  if(!Array.isArray(clients)||clients.length!==2||
    clients[0]?.name!=='nubloxsql'||clients[1]?.name!=='mysql2')
    throw Error('Comparison requires the two explicitly named clients');
  const {iterations,rounds,connections}=parseComparisonArgs(
    [`--iterations=${options?.iterations}`,`--rounds=${options?.rounds}`,
      `--connections=${options?.connections}`]
  );
  const collected=new Map(clients.map(client=>[client.name,{
    connect:[],prepared:[],connectElapsed:0,preparedElapsed:0,rounds:[]
  }]));
  const versions=[];
  for(const client of clients){
    const session=await client.open();
    try{
      const version=await session.version();
      if(typeof version!=='string'||!version)
        throw Error('MySQL server version was not identified');
      versions.push(version);
    }finally{await session.close();}
  }
  if(versions[0]!==versions[1])
    throw Error('Compared clients did not reach the same MySQL server version');

  for(let round=0;round<rounds;round++){
    // ABBA rotation reduces (but does not eliminate) systematic warmup,
    // server cache, thermal and scheduler bias.
    const order=round%2===0?clients:[...clients].reverse();
    for(const client of order){
      const samples=collected.get(client.name);
      const connectStarted=performance.now();
      for(let i=0;i<connections;i++){
        const start=performance.now();
        const session=await client.open();
        samples.connect.push(performance.now()-start);
        await session.close(); // Close and idle time are NOT in connect sample.
      }
      samples.connectElapsed+=performance.now()-connectStarted;

      const session=await client.open();
      try{
        const statement=await session.prepare('SELECT ? AS benchmark_value');
        try{
          // Equal warmup per client, excluded from measured operations.
          for(let i=0;i<8;i++)
            assertValue(await statement.execute(i),i);
          const executeStarted=performance.now();
          for(let i=0;i<iterations;i++){
            const value=round*iterations+i;
            const start=performance.now();
            const received=await statement.execute(value);
            samples.prepared.push(performance.now()-start);
            assertValue(received,value);
          }
          samples.preparedElapsed+=performance.now()-executeStarted;
        }finally{await statement.close();}
      }finally{await session.close();}
      samples.rounds.push(round+1);
    }
  }
  const results={};
  for(const client of clients){
    const values=collected.get(client.name);
    results[client.name]={
      version:client.version,
      connectionOnly:summarize(values.connect,values.connectElapsed),
      preparedExecute:summarize(values.prepared,values.preparedElapsed),
      rounds:values.rounds
    };
  }
  return Object.freeze({
    schemaVersion:1,
    method:'ABBA-order; no pooling; bound integer SELECT; eight unmeasured warmups per prepared statement',
    serverVersion:versions[0],
    options:{iterations,rounds,connections},
    results
  });
}
