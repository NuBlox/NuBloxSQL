import {performance} from 'node:perf_hooks';
import {summarize} from './metrics.mjs';

const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));

async function connectedThreads(session){
  // Use a normal prepared SELECT. Some MySQL commands such as SHOW do not
  // follow the same prepared-statement semantics across server versions.
  const result=await session.query(
    "SELECT VARIABLE_VALUE AS connected FROM performance_schema.global_status WHERE VARIABLE_NAME = 'Threads_connected'"
  );
  const value=Number(result.rows[0]?.connected);
  if(!Number.isSafeInteger(value)||value<1){
    const error=Error('Unable to measure authenticated server connections');
    error.code='AUTH_COUNTER_UNAVAILABLE';
    throw error;
  }
  return value;
}

/**
 * A bounded, independently measurable connect/authentication workload.
 * Samples cover connection establishment only (not SQL or session close).
 * Every successful socket is owned and closed by the same worker.
 * Credentials, query text, and raw failures never enter the result object.
 */
export async function qualifyAuthentication({
  connect,target,concurrency,attempts,wait=pause
}){
  if(typeof connect!=='function'||!target||!Number.isInteger(concurrency)||
    concurrency<1||concurrency>16||!Number.isInteger(attempts)||
    attempts<2||attempts>64||typeof wait!=='function')
    throw Error('Invalid bounded authentication qualification configuration');

  const reference=await connect(target);
  try{
    const before=await connectedThreads(reference);
    const established=[];
    const rejected=[];
    let cursor=0;
    const started=performance.now();
    const workers=Array.from({length:Math.min(concurrency,attempts)},()=> (async()=>{
      while(cursor<attempts){
        const index=cursor++;
        const expectFailure=index%2===1;
        const probe=expectFailure?{
          ...target,
          password:target.password+'-nublox-invalid-auth-'+index
        }:target;
        const start=performance.now();
        let session;
        try{
          session=await connect(probe);
          if(expectFailure)
            throw Error('Invalid authentication was incorrectly accepted');
          if(session.info.transport!==target.security)
            throw Error('Authenticated transport did not match requested security');
          established.push(performance.now()-start);
        }catch(error){
          if(!expectFailure||error?.code!=='DATABASE_ERROR'||
            error.vendorCode!==1045||error.sqlState!=='28000'||
            typeof error.message!=='string'||
            error.message.includes(probe.password))
            throw Error('Unexpected authentication qualification failure');
          rejected.push(performance.now()-start);
        }finally{
          await session?.close();
        }
      }
    })());
    // Join all workers even if one fails; never release the reference socket
    // while other authentication attempts are still in flight.
    const outcomes=await Promise.allSettled(workers);
    if(outcomes.some(outcome=>outcome.status==='rejected')||
      established.length!==Math.ceil(attempts/2)||
      rejected.length!==Math.floor(attempts/2))
      throw Object.assign(Error('Concurrent authentication qualification failed'),
        {code:'AUTH_WORKER_FAILURE'});
    const elapsed=performance.now()-started;

    // Compare server-side physical sessions while keeping exactly one
    // reference connection open. This catches leaked native logins that may
    // not be reflected in JavaScript heap/RSS measurements.
    let after=await connectedThreads(reference);
    let retries=0;
    while(after>before&&retries<30){
      await wait(50);
      retries++;
      after=await connectedThreads(reference);
    }
    if(after>before)
      throw Object.assign(Error('Authentication qualification left unclosed server connections'),
        {code:'AUTH_LEAK_DETECTED'});

    return Object.freeze({
      workloads:{
        connectOnly:summarize(established,elapsed),
        rejectedAuthentication:summarize(rejected,elapsed)
      },
      resources:{
        authThreadsConnectedBefore:before,
        authThreadsConnectedAfter:after,
        authCleanupPolls:retries
      }
    });
  }finally{
    await reference.close();
  }
}
