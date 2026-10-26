import {test} from 'node:test';
import assert from 'node:assert/strict';
import {compareClients,parseComparisonArgs} from './comparison.mjs';

function fake(name,{bad=false,failOpen=false}={}){
  let opened=0,closed=0,prepared=0,statementsClosed=0,executed=0;
  return {
    name,version:'test-1',
    get stats(){return {opened,closed,prepared,statementsClosed,executed};},
    async open(){
      if(failOpen)throw Error('deliberate connect failure');
      opened++;
      let sessionClosed=false;
      return {
        async version(){return '8.4.11';},
        async prepare(sql){
          assert.equal(sql,'SELECT ? AS benchmark_value');
          prepared++;
          let closedStatement=false;
          return {
            async execute(n){
              assert.equal(closedStatement,false);
              executed++;
              return bad?n+1:name==='nubloxsql'?BigInt(n):n;
            },
            async close(){
              assert.equal(closedStatement,false);
              closedStatement=true;
              statementsClosed++;
            }
          };
        },
        async close(){
          assert.equal(sessionClosed,false);
          sessionClosed=true;
          closed++;
        }
      };
    }
  };
}

test('bounded comparison options reject unknown, excessive and duplicate work',()=>{
  assert.deepEqual(parseComparisonArgs(['--iterations=40','--rounds=4','--connections=6']),{
    iterations:40,rounds:4,connections:6
  });
  for(const bad of [
    ['--iterations=7'],['--iterations=10001'],['--rounds=1'],
    ['--rounds=13'],['--connections=1'],['--connections=33'],
    ['--iterations=2','--iterations=3'],['--foo=3'],
    ['--rounds=Infinity'],['--iterations=-1']
  ])assert.throws(()=>parseComparisonArgs(bad));
});

test('ABBA comparison records equal samples, correct results and releases every handle',async()=>{
  const nublox=fake('nubloxsql'),mysql2=fake('mysql2');
  const options={iterations:8,rounds:4,connections:2};
  const report=await compareClients([nublox,mysql2],options);
  assert.equal(report.serverVersion,'8.4.11');
  assert.equal(report.results.nubloxsql.connectionOnly.count,8);
  assert.equal(report.results.mysql2.connectionOnly.count,8);
  assert.equal(report.results.nubloxsql.preparedExecute.count,32);
  assert.equal(report.results.mysql2.preparedExecute.count,32);
  assert.deepEqual(report.results.nubloxsql.rounds,[1,2,3,4]);
  assert.deepEqual(report.results.mysql2.rounds,[1,2,3,4]);
  for(const driver of [nublox,mysql2]){
    assert.deepEqual(driver.stats,{
      opened:1+4*(2+1),closed:1+4*(2+1),
      prepared:4,statementsClosed:4,executed:4*(8+8)
    });
  }
  assert.ok(!JSON.stringify(report).includes('test-password'));
  assert.ok(!JSON.stringify(report).includes('SELECT ?'));
});

test('incorrect returned value fails qualification and closes prepared and native sessions',async()=>{
  const nublox=fake('nubloxsql'),mysql2=fake('mysql2',{bad:true});
  await assert.rejects(compareClients([nublox,mysql2],{
    iterations:8,rounds:2,connections:2
  }),/incorrect value/);
  assert.equal(nublox.stats.opened,nublox.stats.closed);
  assert.equal(mysql2.stats.opened,mysql2.stats.closed);
  assert.equal(mysql2.stats.prepared,mysql2.stats.statementsClosed);
});

test('dial failure does not leak earlier samples or clients',async()=>{
  const nublox=fake('nubloxsql'),mysql2=fake('mysql2',{failOpen:true});
  await assert.rejects(compareClients([nublox,mysql2],{
    iterations:8,rounds:2,connections:2
  }),/connect failure/);
  assert.equal(nublox.stats.opened,nublox.stats.closed);
});
