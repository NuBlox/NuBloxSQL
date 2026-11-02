/**
 * Disposable MySQL 8.4.13 InnoDB write/rollback endurance.
 * Qualification only; no automatic SQL replay, no customer database access.
 */
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {integerOption} from './metrics.mjs';
import {BoundedLatencySamples,BoundedMemoryTimeline,validateMemoryTimeline} from './soak-observations.mjs';

export function parseWriteSoakOptions(args){
  const allowed=new Set(['durationMs','concurrency','maxTransactions']),given={};
  for(const arg of args){
    const match=/^--([A-Za-z]+)=([0-9]+)$/.exec(arg);
    if(!match||!allowed.has(match[1])||Object.hasOwn(given,match[1]))
      throw Error('Unrecognised or duplicate write soak option');
    given[match[1]]=match[2];
  }
  return Object.freeze({
    durationMs:integerOption(given.durationMs??10000,{name:'durationMs',min:400,max:7200000}),
    concurrency:integerOption(given.concurrency??4,{name:'concurrency',min:2,max:8}),
    maxTransactions:integerOption(given.maxTransactions??100000000,
      {name:'maxTransactions',min:100,max:100000000})
  });
}
export function checkWriteSoakEnvironment(env){
  assert.equal(env.CI,'true');
  assert.equal(env.GITHUB_ACTIONS,'true');
  assert.equal(env.NUBLOX_LIVE_MYSQL,'1');
  assert.equal(env.NUBLOX_ALLOW_WRITE_MYSQL_FIXTURE,'1');
  assert.equal(env.NUBLOX_QUALIFICATION_MYSQL_VERSION,'8.4.13');
  assert.equal(env.MYSQL_DATABASE,'nublox_test');
  assert.equal(env.MYSQL_PORT??'3306','3306');
  assert.match(env.GITHUB_SHA??'',/^[a-f0-9]{40}$/);
  assert.match(env.GITHUB_RUN_ID??'',/^\d{1,15}$/);
  return 'nublox_write_soak_'+env.GITHUB_RUN_ID;
}

/** Restrict TLS write tests to a disposable Actions-only fixture and login. */
export function checkVerifiedTlsWriteSoakEnvironment(env){
  assert.equal(env.CI,'true');
  assert.equal(env.GITHUB_ACTIONS,'true');
  assert.equal(env.NUBLOX_LIVE_MYSQL_TLS,'1');
  assert.equal(env.NUBLOX_ALLOW_WRITE_MYSQL_FIXTURE,'1');
  assert.equal(env.NUBLOX_TEST_MYSQL_VERSION,'8.4.13');
  assert.equal(env.NUBLOX_QUALIFICATION_MYSQL_VERSION,'8.4.13');
  assert.equal(env.MYSQL_DATABASE,'nublox_test');
  assert.equal(env.MYSQL_TLS_PORT,'3307');
  assert.equal(env.MYSQL_WRITE_USER,'nublox_write_test');
  assert.equal(env.MYSQL_USER,'root');
  assert.ok(typeof env.MYSQL_WRITE_PASSWORD==='string'&&env.MYSQL_WRITE_PASSWORD.length>=8);
  assert.ok(typeof env.NUBLOX_TLS_CA_FILE==='string'&&env.NUBLOX_TLS_CA_FILE.length>0);
  assert.ok(typeof env.NUBLOX_TLS_OTHER_CA_FILE==='string'&&env.NUBLOX_TLS_OTHER_CA_FILE.length>0);
  assert.match(env.GITHUB_SHA??'',/^[a-f0-9]{40}$/);
  assert.match(env.GITHUB_RUN_ID??'',/^\d{1,15}$/);
  return 'nublox_write_soak_'+env.GITHUB_RUN_ID;
}

const toCount=value=>{
  const count=Number(value);
  assert.ok(Number.isSafeInteger(count)&&count>=0,'Invalid MySQL numeric result');
  return count;
};
const memory=()=>process.memoryUsage();
export async function runWriteSoak({
  connect,createPool,target,table,options,now=()=>performance.now(),
  memoryUsage=memory,administratorTarget=target
}){
  assert.match(table??'',/^nublox_write_soak_\d{1,15}$/);
  assert.equal(typeof connect,'function');
  assert.equal(typeof createPool,'function');
  const p=table;
  const sql={
    create:'CREATE TABLE '+p+' (worker_id INT NOT NULL PRIMARY KEY, counter BIGINT NOT NULL) ENGINE=InnoDB',
    insert:'INSERT INTO '+p+' (worker_id,counter) VALUES (?,?)',
    lock:'SELECT counter FROM '+p+' WHERE worker_id=? FOR UPDATE',
    update:'UPDATE '+p+' SET counter=counter+1 WHERE worker_id=?',
    read:'SELECT counter FROM '+p+' WHERE worker_id=?',
    audit:'SELECT worker_id,counter FROM '+p+' ORDER BY worker_id',
    drop:'DROP TABLE '+p
  };
  let admin,pool,timer,tableCreated=false,tableDropped=false,result;
  const counters=Array.from({length:options.concurrency},()=>({
    committed:0,rolledBack:0,verified:0
  }));
  const deliberate=new Error('Expected rollback');
  try{
    admin=await connect(administratorTarget);
    assert.match(admin.info.version,/^8\.4\.13(?:[-+].*)?$/,'Unqualified MySQL version');
    await admin.query(sql.create);
    tableCreated=true;
    for(let worker=0;worker<options.concurrency;worker++)
      await admin.query(sql.insert,[worker,0]);
    pool=createPool(target,{maxConnections:options.concurrency,
      acquireTimeoutMs:12000,idleTimeoutMs:60000,healthCheckTimeoutMs:2000});
    const samples=new BoundedLatencySamples(),timeline=new BoundedMemoryTimeline();
    let attempts=0,completed=0,failure=null;
    const start=now();
    timeline.record(0,memoryUsage());
    timer=setInterval(()=>timeline.record(now()-start,memoryUsage()),30000);
    timer.unref();
    const workers=Array.from({length:options.concurrency},(_,worker)=>(async()=>{
      let iteration=0;
      while(!failure&&now()-start<options.durationMs){
        if(attempts>=options.maxTransactions){
          failure=new Error('Write soak exhausted operation ceiling before duration');
          return;
        }
        attempts++;
        const rollback=iteration++%11===0;
        const expected=counters[worker].committed;
        const began=now();
        try{
          await pool.withConnection(async lease=>{
            try{
              await lease.transaction(async tx=>{
                const before=await tx.query(sql.lock,[worker]);
                assert.equal(before.rows.length,1);
                assert.equal(toCount(before.rows[0].counter),expected);
                const updated=await tx.query(sql.update,[worker]);
                assert.equal(toCount(updated.affectedRows),1);
                const after=await tx.query(sql.read,[worker]);
                assert.equal(toCount(after.rows[0]?.counter),expected+1);
                if(rollback)throw deliberate;
              });
              assert.equal(rollback,false,'Rollback suppressed');
            }catch(error){
              if(!rollback||error!==deliberate)throw error;
            }
          });
          // Separate checkout after transaction end must see COMMIT or ROLLBACK.
          await pool.withConnection(async lease=>{
            const read=await lease.query(sql.read,[worker]);
            assert.equal(read.rows.length,1);
            assert.equal(toCount(read.rows[0].counter),expected+(rollback?0:1),
              'Persisted counter failed transaction reconciliation');
          });
          counters[worker].verified++;
          if(rollback)counters[worker].rolledBack++;
          else counters[worker].committed++;
          completed++;
          samples.record(now()-began);
        }catch(error){failure=error;} // No replay of any ambiguous write.
      }
    })());
    await Promise.all(workers);
    clearInterval(timer);timer=null;
    const elapsed=now()-start;
    timeline.record(elapsed,memoryUsage());
    if(failure)throw failure;
    assert.ok(elapsed>=options.durationMs,'Soak ended before requested duration');
    assert.ok(attempts<options.maxTransactions,'Soak hit operation ceiling');
    assert.equal(attempts,completed,'Unaccounted transaction');
    const committed=counters.reduce((total,c)=>total+c.committed,0);
    const rolledBack=counters.reduce((total,c)=>total+c.rolledBack,0);
    assert.ok(committed>=options.concurrency&&rolledBack>=options.concurrency);
    assert.equal(committed+rolledBack,completed);
    const beforeClose=pool.stats;
    assert.ok(beforeClose.size<=options.concurrency&&beforeClose.pending===0&&beforeClose.active===0);
    await pool.close();
    const afterClose=pool.stats;
    assert.ok(afterClose.size===0&&afterClose.idle===0&&afterClose.pending===0&&
      afterClose.active===0&&afterClose.connecting===0,'Pool resource leak');
    // This connection never participated in pool transactions.
    const rows=(await admin.query(sql.audit)).rows;
    assert.equal(rows.length,options.concurrency);
    const summary=[];
    let finalSum=0;
    for(let worker=0;worker<options.concurrency;worker++){
      assert.equal(toCount(rows[worker].worker_id),worker);
      const stored=toCount(rows[worker].counter);
      assert.equal(stored,counters[worker].committed,'Final durable counter mismatch');
      finalSum+=stored;
      summary.push({worker,committed:counters[worker].committed,
        rolledBack:counters[worker].rolledBack,
        verified:counters[worker].verified,finalCounter:stored});
    }
    assert.equal(finalSum,committed);
    const memoryTimeline=timeline.summary();
    const memoryTrend=validateMemoryTimeline(memoryTimeline,
      {minDurationMs:options.durationMs});
    result={serverVersion:admin.info.version,requestedDurationMs:options.durationMs,
      observedDurationMs:elapsed,attemptedTransactions:attempts,
      completedTransactions:completed,committedTransactions:committed,
      rolledBackTransactions:rolledBack,verifiedReads:completed,
      finalCounterSum:finalSum,workers:summary,latency:samples.summarize(elapsed),
      resources:{poolBeforeClose:beforeClose,poolAfterClose:afterClose,
        memoryTimeline,memoryTrend}};
  }finally{
    if(timer)clearInterval(timer);
    try{if(pool)await pool.close();}
    finally{
      if(admin)try{
        if(tableCreated){await admin.query(sql.drop);tableDropped=true;}
      }finally{await admin.close();}
    }
  }
  assert.equal(tableDropped,true,'Write test table not removed');
  return Object.freeze({...result,tableDropped});
}
