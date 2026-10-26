import {test} from 'node:test';
import assert from 'node:assert/strict';
import {runComparison,COMPARISON_SQL} from './core.mjs';

function fakeAdapter(label,events,{bad=false}={}){
  const state={opened:0,closed:0,prepared:0,closedStatements:0,executed:0};
  return {
    state,
    async open(){
      state.opened++;
      events.push('open:'+label);
      let closed=false;
      return {
        async prepare(sql){
          assert.equal(sql,COMPARISON_SQL);
          state.prepared++;
          let statementClosed=false;
          return {
            async execute(params){
              if(closed||statementClosed)throw Error('Invalid statement use');
              assert.equal(params.length,1);
              state.executed++;
              return bad&&params[0]===7?999:BigInt(params[0]);
            },
            async close(){
              if(statementClosed)throw Error('Statement closed twice');
              statementClosed=true;
              state.closedStatements++;
            }
          };
        },
        async close(){
          if(closed)throw Error('Session closed twice');
          closed=true;
          state.closed++;
        }
      };
    }
  };
}

test('alternating benchmark matches iterations, prepares, and closes all native sessions',async()=>{
  const events=[];
  const native=fakeAdapter('native',events);
  const peer=fakeAdapter('peer',events);
  const trials=await runComparison({
    adapters:{nubloxsql:native,mysql2:peer},
    iterations:8,concurrency:2,rounds:2
  });
  assert.equal(trials.length,12,'three workloads x two clients x two rounds');
  for(const row of trials){
    assert.equal(row.count,8);
    assert.equal(row.elapsedMs>0,true);
    assert.ok(row.p50Ms>=0&&row.p99Ms>=row.p50Ms);
    assert.ok(['connectionOnly','preparedSequential','preparedConcurrent'].includes(row.workload));
    assert.ok(['nubloxsql','mysql2'].includes(row.client));
  }
  assert.deepEqual(trials.filter(x=>x.workload==='connectionOnly').map(x=>x.client),
    ['nubloxsql','mysql2','mysql2','nubloxsql']);
  for(const adapter of [native,peer]){
    assert.equal(adapter.state.opened,24);
    assert.equal(adapter.state.closed,adapter.state.opened);
    assert.equal(adapter.state.prepared,6);
    assert.equal(adapter.state.closedStatements,6);
    assert.equal(adapter.state.executed,80,'warmups and timed commands each execute once');
  }
  assert.ok(!JSON.stringify(trials).includes('SELECT ?'));
});

test('comparison refuses unchecked limits and missing competitors',async()=>{
  const native=fakeAdapter('native',[]);
  const peer=fakeAdapter('peer',[]);
  for(const bad of [
    {iterations:0},{iterations:2001},{concurrency:0},{concurrency:9},
    {rounds:1},{rounds:9}
  ])await assert.rejects(runComparison({
    adapters:{nubloxsql:native,mysql2:peer},
    iterations:8,concurrency:2,rounds:2,...bad
  }),/Invalid bounded comparison/);
  await assert.rejects(runComparison({
    adapters:{nubloxsql:native},iterations:8,concurrency:2,rounds:2
  }),/Both native and competitor adapters/);
});

test('comparison rejects incorrect results without retaining prepared statements',async()=>{
  const events=[];
  const native=fakeAdapter('native',events,{bad:true});
  const peer=fakeAdapter('peer',events);
  await assert.rejects(runComparison({
    adapters:{nubloxsql:native,mysql2:peer},
    iterations:8,concurrency:2,rounds:2
  }),/Comparison query returned incorrect data/);
  assert.equal(native.state.opened,native.state.closed);
  assert.equal(peer.state.opened,peer.state.closed);
  assert.equal(native.state.prepared,native.state.closedStatements);
  assert.equal(peer.state.prepared,peer.state.closedStatements);
});
