import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseOutageOptions,validateOutageEvidence} from './outage-evidence.mjs';

const version='8.4.13',revision='a'.repeat(40);
const pressure=()=>({completed:12,peakPending:10,peakSize:2,
  sizeAfterClose:0,pendingAfterClose:0});
const cycle=i=>({number:i+1,status:'passed',pressureBefore:pressure(),
  pressureAfter:pressure(),recovery:{status:'passed',revision,
   serverVersion:version,inFlightExecutions:1,expectedInterrupted:true,
   preparedRevoked:true,oldSessionRetired:true,poolReconnected:true,
   exactlyOnce:true,poolClosed:0},
  rssAfterBytes:50_000_000,heapAfterBytes:3_000_000});
const valid=()=>({schemaVersion:1,kind:'mysql-repeated-outages',status:'passed',
  failureCode:null,revision,environment:{image:'mysql:'+version,
   serverVersion:version,node:'v22.14.0',ci:true,platform:'linux',arch:'x64'},
  configuration:{cycles:3,poolSize:2,borrowers:12},
  cycles:[cycle(0),cycle(1),cycle(2)]});
const check=value=>validateOutageEvidence(value,{version,revision,minimumCycles:3});

test('outage CLI refuses missing, duplicate and unbounded cycles',()=>{
  assert.deepEqual(parseOutageOptions(['--cycles=3']),{
    cycles:3,poolSize:2,borrowers:12});
  for(const args of [[],['--cycles=1'],['--cycles=13'],['--cycles=-1'],
    ['--cycles=NaN'],['--cycles=2','--cycles=3'],['--poolSize=1']]){
    assert.throws(()=>parseOutageOptions(args));
  }
});

test('three separate destructive crashes and six bounded pool pressure tests pass',()=>{
  const result=check(valid());
  assert.deepEqual(result,{schemaVersion:1,kind:'mysql-repeated-outages',
    status:'passed',revision,version,cycles:3,verifiedPressurePasses:6,
    verifiedRestarts:3});
});

test('missing cycles, reused cycle numbers, absent pressure and capacity leaks fail',()=>{
  const cases=[
    r=>{r.cycles.pop();},
    r=>{r.cycles[1].number=1;},
    r=>{r.cycles[2].pressureBefore.peakPending=0;},
    r=>{r.cycles[2].pressureAfter.peakSize=3;},
    r=>{r.cycles[1].pressureBefore.sizeAfterClose=1;},
    r=>{r.cycles[0].pressureAfter.completed=11;},
    r=>{r.configuration.cycles=1;}
  ];
  for(const change of cases){
    const r=valid();change(r);assert.throws(()=>check(r));
  }
});

test('missing recovery, replay, wrong version or revision and invalid runtime fail',()=>{
  const cases=[
    r=>{r.status='failed';},
    r=>{r.failureCode='TIMEOUT';},
    r=>{r.cycles[2].recovery.exactlyOnce=false;},
    r=>{r.cycles[0].recovery.poolClosed=1;},
    r=>{r.cycles[1].recovery.inFlightExecutions=2;},
    r=>{r.cycles[0].recovery.poolReconnected=false;},
    r=>{r.cycles[0].recovery.serverVersion='8.4.11';},
    r=>{r.cycles[2].recovery.revision='b'.repeat(40);},
    r=>{r.environment.image='mysql:latest';},
    r=>{r.environment.node='v20.0.0';},
    r=>{r.environment.serverVersion='8.4.11';},
    r=>{r.revision='b'.repeat(40);}
  ];
  for(const change of cases){
    const r=valid();change(r);assert.throws(()=>check(r));
  }
});
