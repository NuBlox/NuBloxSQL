'use strict';

const assert = require('node:assert/strict');
const api = require('..');
const configuration = require('../lib/client/DatabaseConfigurationPlanner');
const bootstrap = require('../lib/client/DatabaseBootstrapPlanner');
const installation = require('../lib/lifecycle/EngineInstallationPlanner');
const initialization = require('../lib/lifecycle/EngineInitializationPlanner');

function clone(value){return JSON.parse(JSON.stringify(value));}

async function securityIntegrity(){
  const discovery={
    schemaVersion:1,
    dialect:'postgresql',
    settings:[{
      name:'work_mem', value:'4096', scope:'session', apply:'immediate',
      mutable:true, restartRequired:false, source:null, description:null,
      native:{context:'user'}
    }]
  };
  const cfg=api.planDatabaseConfiguration(discovery,{changes:[{name:'work_mem',value:'8192'}]});
  const b=api.planDatabaseBootstrap({database:'app'}, {targetDialect:'postgresql'});
  const provider={
    id:'integrity-provider',kind:'test',actions:['inspect-target','install','initialize','verify-install','verify-initialize'],
    async inspectTarget(){return {
      targetId:'integrity-host',platform:{os:'linux',architecture:'x64'},
      installed:[{engine:'postgresql',version:'18',state:'ready'}],resources:[]
    };}
  };
  const selection=api.selectDatabaseEngine({engine:'postgresql',targetVersion:'18'});
  const target=await api.inspectEngineTarget(provider);
  const install=api.planEngineInstallation(selection,target);
  const init=api.planEngineInitialization(selection,target,{dataDirectory:'/tmp/integrity-test'});

  const cases=[
    {name:'configuration',plan:cfg,validator:configuration.validate,mutate:p=>{p.steps[0].sql='DROP DATABASE app';}},
    {name:'bootstrap',plan:b,validator:bootstrap.validate,mutate:p=>{p.steps[0].sql='DROP DATABASE app';}},
    {name:'installation',plan:install,validator:installation.validate,mutate:p=>{p.steps[0].requirements.hostMutation=true;}},
    {name:'initialization',plan:init,validator:initialization.validate,mutate:p=>{p.steps[0].evidence.resourceKey='cluster:wrong';}}
  ];

  for(const entry of cases) {
    const restored=clone(entry.plan);
    const verified=entry.validator(restored);
    assert.ok(Object.isFrozen(verified));
    assert.ok(Object.isFrozen(verified.steps[0]));
    assert.notStrictEqual(verified,restored,'validation must snapshot mutable input');
    const tampered=clone(entry.plan);
    entry.mutate(tampered);
    assert.throws(()=>entry.validator(tampered),/planHash integrity mismatch/,entry.name);
    assert.throws(()=>entry.validator({...entry.plan,executable:false}),/planHash integrity mismatch/);
    assert.throws(()=>entry.validator({...entry.plan,summary:{steps:999}}),/planHash integrity mismatch/);
    assert.throws(()=>entry.validator({...entry.plan,unexpected:'unsafe'}),/planHash integrity mismatch/);
    assert.throws(()=>entry.validator({...entry.plan,planHash:'xyz'}),/planHash/);
  }

  let executed=0;
  const db={
    dialect:'postgresql',
    all:async()=>[],execute:async()=>{executed++;},
  };
  const maliciousCfg=clone(cfg);maliciousCfg.steps[0].sql='DROP DATABASE app';
  await assert.rejects(api.executeDatabaseConfiguration(db,maliciousCfg,{
    approval:'all',approvedPlanHash:cfg.planHash
  }),/planHash integrity mismatch/);
  const maliciousBoot=clone(b);maliciousBoot.steps[0].sql='DROP DATABASE app';
  await assert.rejects(api.executeDatabaseBootstrap(db,maliciousBoot),/planHash integrity mismatch/);
  const maliciousInstall=clone(install);maliciousInstall.steps[0].requirements.hostMutation=true;
  await assert.rejects(api.executeEngineInstallation(provider,maliciousInstall,{
    approvedPlanHash:install.planHash
  }),/planHash integrity mismatch/);
  const maliciousInit=clone(init);maliciousInit.steps[0].evidence.resourceKey='cluster:wrong';
  await assert.rejects(api.executeEngineInitialization(provider,maliciousInit,{
    approvedPlanHash:init.planHash
  }),/planHash integrity mismatch/);
  assert.equal(executed,0,'tampered plans may not reach execution');
}

securityIntegrity().then(()=>{
  console.log('NuBloxSQL lifecycle plan integrity: PASS');
}).catch(e=>{console.error(e);process.exitCode=1;});
