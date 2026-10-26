import {test} from 'node:test';
import assert from 'node:assert/strict';
import {qualifyAuthentication} from './authentication.mjs';

const target={
  engine:'mysql',host:'127.0.0.1',port:3306,user:'tester',
  password:'private-qualification-password',security:'verified-tls'
};
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));

function fakeConnect({rejectCode='DATABASE_ERROR',leak=false}={}){
  let open=0,peak=0,accepted=0,denied=0,closed=0;
  return {
    get stats(){return {open,peak,accepted,denied,closed};},
    async connect(options){
      open++;
      peak=Math.max(peak,open);
      await sleep(2);
      const bad=options.password!==target.password;
      if(bad){
        denied++;
        open--;
        const error=Error('MySQL server rejected the connection');
        error.code=rejectCode;
        error.vendorCode=1045;
        error.sqlState='28000';
        throw error;
      }
      accepted++;
      let done=false;
      const reference=accepted===1;
      return {
        info:{transport:options.security},
        async query(sql){
          assert.equal(sql,
            "SELECT VARIABLE_VALUE AS connected FROM performance_schema.global_status WHERE VARIABLE_NAME = 'Threads_connected'");
          return {rows:[{connected:String(open)}]};
        },
        async close(){
          if(done)return;
          done=true;
          closed++;
          if(!leak||reference)open--;
        }
      };
    }
  };
}

test('authentication qualification measures two non-SQL latency series and fully closes logins',async()=>{
  const peer=fakeConnect();
  const report=await qualifyAuthentication({
    connect:options=>peer.connect(options),
    target,concurrency:3,attempts:12,wait:()=>Promise.resolve()
  });
  assert.equal(report.workloads.connectOnly.count,6);
  assert.equal(report.workloads.rejectedAuthentication.count,6);
  assert.ok(report.workloads.connectOnly.p95Ms>=0);
  assert.ok(report.workloads.rejectedAuthentication.p99Ms>=0);
  assert.equal(report.resources.authThreadsConnectedBefore,1);
  assert.equal(report.resources.authThreadsConnectedAfter,1);
  assert.equal(report.resources.authCleanupPolls,0);
  assert.equal(report.resources.authRejectionProfile,'verified-tls');
  assert.equal(peer.stats.open,0);
  assert.equal(peer.stats.accepted,7,'six accepted probes plus one reference');
  assert.equal(peer.stats.denied,6);
  assert.equal(peer.stats.closed,7);
  assert.ok(peer.stats.peak<=4,'reference plus three simultaneous workers');
  assert.ok(!JSON.stringify(report).includes(target.password));
  assert.ok(!JSON.stringify(report).includes('performance_schema.global_status'));
});

test('concurrent authentication rejects wrong vendor error and still closes all accepted sessions',async()=>{
  const peer=fakeConnect({rejectCode:'CONNECTION_FAILED'});
  await assert.rejects(qualifyAuthentication({
    connect:options=>peer.connect(options),
    target,concurrency:4,attempts:8,wait:()=>Promise.resolve()
  }),/Concurrent authentication qualification failed/);
  assert.equal(peer.stats.open,0,'all workers must finish before reference closes');
  assert.equal(peer.stats.closed,5);
});

test('auth qualification detects server-side session leaks invisible to JS ownership',async()=>{
  const peer=fakeConnect({leak:true});
  await assert.rejects(qualifyAuthentication({
    connect:options=>peer.connect(options),
    target,concurrency:2,attempts:4,wait:()=>Promise.resolve()
  }),/unclosed server connections/);
  assert.equal(peer.stats.open,2,'the fake server retains its two leaked sockets');
  assert.equal(peer.stats.closed,3,'all client session close calls still ran');
});

test('isolated-local profile measures connection setup but does not pretend to benchmark TLS-only credential rejection',async()=>{
  const peer=fakeConnect();
  const report=await qualifyAuthentication({
    connect:options=>peer.connect(options),
    target:{...target,security:'isolated-local'},concurrency:2,attempts:6,
    wait:()=>Promise.resolve()
  });
  assert.equal(report.workloads.connectOnly.count,6);
  assert.equal(report.workloads.rejectedAuthentication.count,0);
  assert.equal(report.workloads.rejectedAuthentication.p95Ms,null);
  assert.equal(report.resources.authRejectionProfile,'not-qualified-isolated-local');
  assert.equal(peer.stats.denied,0,'no unsupported plaintext full-auth flow is attempted');
  assert.equal(peer.stats.open,0);
});
