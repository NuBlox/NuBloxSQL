'use strict';

// Base transaction runner must retain native/SQLite rollback and resource
// lifetime semantics. Integration tests separately qualify retries/savepoints.
const assert = require('node:assert/strict');
const facade = require('../lib/client/Client');
const runner = require('../lib/client/runtime/TransactionRunner');

function adapter(target, pool) {
  return {
    descriptor:{capabilities:{}},
    createConnection(){return target;},
    createPool(){return pool;}
  };
}
async function main() {
  assert.ok(Object.isFrozen(runner));
  assert.equal(typeof runner.run,'function');

  // Pooled path: no extra connection factory; callback-scoped resources close.
  const pooledEvents=[], pooledTarget={label:'leased-connection'};
  const pool={
    async withTransaction(fn,options){
      pooledEvents.push(['withTransaction',options]);
      return fn(pooledTarget);
    }
  };
  const pooledAdapter=adapter(pooledTarget,pool);
  const pooled=new facade.Client(pooledAdapter,'mysql',{pool:true});
  const poolOptions={readOnly:true};
  const poolResult=await runner.run(pooled,facade.Client,async tx=>{
    assert.strictEqual(tx.native,pooledTarget);
    assert.strictEqual(tx._ownsTarget,false);
    assert.strictEqual(tx._isPool,false);
    tx._preparedStatements.add({async close(){pooledEvents.push('prepared-closed');}});
    return 'pooled-result';
  },poolOptions);
  assert.equal(poolResult,'pooled-result');
  assert.deepEqual(pooledEvents,[['withTransaction',poolOptions],'prepared-closed']);
  await assert.rejects(runner.run(pooled,facade.Client,null,{}),/requires a function/);

  // SQLite transaction controls and prepared-statement cleanup ordering.
  const events=[],sqliteTarget={
    begin(mode){events.push('begin:'+mode);},
    commit(){events.push('commit');},
    rollback(){events.push('rollback');}
  };
  const sqlite=new facade.Client(adapter(sqliteTarget), 'sqlite',{pool:false});
  const result=await runner.run(sqlite,facade.Client,async tx=>{
    assert.strictEqual(tx.native,sqliteTarget);
    assert.strictEqual(tx._ownsTarget,false);
    tx._preparedStatements.add({async close(){events.push('prepared-closed');}});
    events.push('callback');
    return 42;
  },{mode:'immediate'});
  assert.equal(result,42);
  assert.deepEqual(events,['begin:immediate','callback','prepared-closed','commit']);

  // The original exception is preserved and both cleanup failures attached.
  const resourceError=new Error('cleanup failure');
  const rollbackError=new Error('rollback failure');
  const primaryError=new Error('callback failed');
  const failureEvents=[];
  const failureTarget={
    begin(mode){failureEvents.push('begin:'+mode);},
    commit(){assert.fail('must not commit failure');},
    rollback(){failureEvents.push('rollback');throw rollbackError;}
  };
  const failed=new facade.Client(adapter(failureTarget),'sqlite',{pool:false});
  await assert.rejects(runner.run(failed,facade.Client,async tx=>{
    tx._preparedStatements.add({async close(){failureEvents.push('cleanup');throw resourceError;}});
    throw primaryError;
  }),error=>{
    assert.strictEqual(error,primaryError);
    assert.strictEqual(error.resourceError,resourceError);
    assert.strictEqual(error.rollbackError,rollbackError);
    return true;
  });
  assert.deepEqual(failureEvents,['begin:deferred','cleanup','cleanup','rollback']);

  // Native non-pooled connection passes through its transaction adapter.
  const nativeOptions={isolationLevel:'serializable'};
  const nativeEvents=[], nativeTx={label:'native-transaction'};
  const nativeConnection={
    withTransaction(fn,options){
      nativeEvents.push(['withTransaction',options]);
      return fn(nativeTx);
    }
  };
  const native=new facade.Client(adapter(nativeConnection),'postgresql',{pool:false});
  assert.equal(await runner.run(native,facade.Client,async tx=>{
    assert.strictEqual(tx.native,nativeTx);
    tx._preparedStatements.add({async close(){nativeEvents.push('prepared-closed');}});
    return 'ok';
  },nativeOptions),'ok');
  assert.deepEqual(nativeEvents,[['withTransaction',nativeOptions],'prepared-closed']);

  // Unsupported native runtimes reject rather than implying transactions.
  const unsupported=new facade.Client(adapter({}),'sqlserver',{pool:false});
  await assert.rejects(runner.run(unsupported,facade.Client,async()=>{}),
    /does not support transactions/);

  // Public Client transaction method keeps delegating through runner.
  const facadeEvents=[];
  const facadeTarget={
    begin(mode){facadeEvents.push(mode);},commit(){facadeEvents.push('commit');},
    rollback(){facadeEvents.push('rollback');}
  };
  const publicClient=new facade.Client(adapter(facadeTarget),'sqlite',{pool:false});
  assert.equal(await publicClient.transaction(async tx=>{
    assert.strictEqual(tx.native,facadeTarget);
    return 'public-client';
  },{mode:'exclusive'}),'public-client');
  assert.deepEqual(facadeEvents,['exclusive','commit']);

  console.log('NuBloxSQL base SQL transaction runner boundary: PASS');
}
main().catch(error=>{console.error(error.stack||error);process.exitCode=1;});
