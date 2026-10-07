'use strict';

var assert=require('assert');
var sql=require('..');

function provider(state,actions){
  state=state||{};
  actions=actions||['inspect-target','install','initialize'];
  return {
    id:'test-provider',
    kind:'test',
    actions:actions,
    metadata:{test:true},
    async inspectTarget(){
      var installed=(state.installed||[]).slice();
      if(state.reverseInstalled)installed.reverse();
      return {
        targetId:state.targetId||'host-1',
        platform:{os:'linux',family:'debian',version:'13',architecture:'arm64'},
        elevated:state.elevated===undefined?false:state.elevated,
        installed:installed,
        resources:(state.resources||[]).slice(),
        facts:Object.assign({stable:true},state.facts||{})
      };
    },
    async executeAction(request){
      state.requests=state.requests||[];
      state.requests.push(request);

      if(request.action==='install'){
        if(state.installResult==='pending-reboot'){
          state.installed=[{engine:request.engine,version:request.targetVersion,state:'pending-reboot'}];
          return {status:'pending-reboot',message:'Host reboot required.',reference:'install-1'};
        }
        if(state.installResult==='failed'){
          return {status:'failed',message:'Install failed.',reference:'install-1'};
        }
        state.installed=[{
          engine:request.engine,
          version:request.targetVersion,
          state:'ready',
          edition:request.evidence&&request.evidence.edition||null,
          distribution:request.evidence&&request.evidence.distribution||null,
          components:request.evidence&&request.evidence.components||[]
        }];
        if(state.secretEvidence)return {status:'succeeded',evidence:{password:'leak'}};
        return {status:'succeeded',reference:'install-1',evidence:{media:'qualified'}};
      }

      if(request.action==='initialize'){
        var key=request.evidence.resourceKey;
        if(state.initializeResult==='pending-restart'){
          state.resources=[{engine:request.engine,key:key,state:'pending-restart'}];
          return {status:'pending-restart',message:'Service restart required.',reference:'init-1'};
        }
        state.resources=[{engine:request.engine,key:key,state:'ready'}];
        return {status:'succeeded',reference:'init-1',evidence:{resource:key}};
      }

      return {status:'failed',message:'Unexpected action '+request.action};
    }
  };
}

async function targetAndPlan(engine,version,state,strategy){
  var p=provider(state);
  var selection=sql.selectDatabaseEngine({
    engine:engine,
    targetVersion:version,
    installationStrategy:strategy
  });
  var target=await sql.inspectEngineTarget(p);
  return {provider:p,selection:selection,target:target,plan:sql.planEngineInstallation(selection,target)};
}

async function deterministicInspection(){
  var state={
    installed:[
      {engine:'mysql',version:'9.7',state:'ready'},
      {engine:'postgresql',version:'18',state:'ready'}
    ]
  };
  var p=provider(state);
  var a=await sql.inspectEngineTarget(p);
  state.reverseInstalled=true;
  var b=await sql.inspectEngineTarget(p);
  assert.strictEqual(a.inspectionHash,b.inspectionHash);
}

async function approvalAndDryRun(){
  var ctx=await targetAndPlan('postgresql','18',{},'package');

  var blocked=await sql.executeEngineInstallation(ctx.provider,ctx.plan);
  assert.strictEqual(blocked.status,'blocked');
  assert.match(blocked.reason,/approvedPlanHash/);
  assert.strictEqual((ctx.provider.requests||[]).length,0);

  var dry=await sql.executeEngineInstallation(ctx.provider,ctx.plan,{dryRun:true});
  assert.strictEqual(dry.status,'dry-run');
  assert.strictEqual(dry.preflight.drift.length,0);
  assert.strictEqual(dry.audit.length,2);
  assert.strictEqual((ctx.provider.requests||[]).length,0);
}

async function drift(){
  var state={facts:{revision:'a'}};
  var ctx=await targetAndPlan('postgresql','18',state,'package');
  state.facts.revision='b';

  var inspection=await sql.inspectEngineInstallationPlan(ctx.provider,ctx.plan);
  assert.strictEqual(inspection.drift.length,1);
  assert.strictEqual(inspection.drift[0].reason,'target-state-changed');

  var result=await sql.executeEngineInstallation(ctx.provider,ctx.plan,{approvedPlanHash:ctx.plan.planHash});
  assert.strictEqual(result.status,'drifted');
  assert.strictEqual((ctx.provider.requests||[]).length,0);
}

async function installationSuccessAndSecrets(){
  var state={};
  var ctx=await targetAndPlan('postgresql','18',state,'package');
  var result=await sql.executeEngineInstallation(ctx.provider,ctx.plan,{
    approvedPlanHash:ctx.plan.planHash,
    resolveInputs:async function(){return {password:'runtime-only-secret'};}
  });
  assert.strictEqual(result.status,'succeeded');
  assert.strictEqual(result.audit.length,2);
  assert.strictEqual(result.audit[0].status,'succeeded');
  assert.strictEqual(result.audit[1].verification.ok,true);
  assert.strictEqual(state.installed[0].state,'ready');
  assert.strictEqual(state.requests[0].inputs.password,'runtime-only-secret');
  assert.strictEqual(JSON.stringify(result).includes('runtime-only-secret'),false);
}

async function externalInstall(){
  var state={};
  var p=provider(state,['inspect-target']);
  var selection=sql.selectDatabaseEngine({engine:'postgresql',targetVersion:'18',installationStrategy:'package'});
  var target=await sql.inspectEngineTarget(p);
  var plan=sql.planEngineInstallation(selection,target);
  assert.strictEqual(plan.summary.external,1);
  assert.strictEqual(plan.summary.provider,1);

  var result=await sql.executeEngineInstallation(p,plan,{
    approvedPlanHash:plan.planHash,
    externalHandler:async function(context){
      assert.strictEqual(context.step.action,'install-runtime');
      state.installed=[{engine:'postgresql',version:'18',state:'ready'}];
      return {status:'succeeded',reference:'external-1'};
    }
  });
  assert.strictEqual(result.status,'succeeded');
  assert.strictEqual(result.audit[1].verification.ok,true);
}

async function sqlServerLicense(){
  var state={};
  var ctx=await targetAndPlan('sqlserver','2025',state,'setup');

  var blocked=await sql.executeEngineInstallation(ctx.provider,ctx.plan,{
    approvedPlanHash:ctx.plan.planHash
  });
  assert.strictEqual(blocked.status,'blocked');
  assert.match(blocked.reason,/license acceptance/);

  var result=await sql.executeEngineInstallation(ctx.provider,ctx.plan,{
    approvedPlanHash:ctx.plan.planHash,
    licenseAcceptance:{accepted:true,reference:'accepted-by-test'}
  });
  assert.strictEqual(result.status,'succeeded');
  assert.strictEqual(result.licenseAcceptance.accepted,true);
  assert.strictEqual(state.requests[0].licenseAcceptance.accepted,true);
}

async function pendingReboot(){
  var state={installResult:'pending-reboot'};
  var ctx=await targetAndPlan('sqlserver','2025',state,'setup');
  var result=await sql.executeEngineInstallation(ctx.provider,ctx.plan,{
    approvedPlanHash:ctx.plan.planHash,
    licenseAcceptance:{accepted:true,reference:'accepted'}
  });
  assert.strictEqual(result.status,'pending-reboot');

  var pendingTarget=await sql.inspectEngineTarget(ctx.provider);
  var pendingPlan=sql.planEngineInstallation(ctx.selection,pendingTarget);
  assert.strictEqual(pendingPlan.summary.blocked,1);
  assert.strictEqual(pendingPlan.steps[0].action,'installation-incomplete');

  state.installResult=null;
  state.installed=[{engine:'sqlserver',version:'2025',state:'ready'}];
  var readyTarget=await sql.inspectEngineTarget(ctx.provider);
  var readyPlan=sql.planEngineInstallation(ctx.selection,readyTarget);
  assert.strictEqual(readyPlan.summary.satisfied,2);
}

async function initializationSuccess(){
  var state={installed:[{engine:'postgresql',version:'18',state:'ready'}]};
  var p=provider(state);
  var selection=sql.selectDatabaseEngine({engine:'postgresql',targetVersion:'18'});
  var target=await sql.inspectEngineTarget(p);
  var plan=sql.planEngineInitialization(selection,target,{dataDirectory:'/data/pg18'});

  var result=await sql.executeEngineInitialization(p,plan,{
    approvedPlanHash:plan.planHash
  });
  assert.strictEqual(result.status,'succeeded');
  assert.strictEqual(result.audit[1].verification.ok,true);
  assert.strictEqual(state.resources[0].key,'cluster:/data/pg18');
}

async function pendingRestart(){
  var state={
    installed:[{engine:'mysql',version:'8.4',state:'ready'}],
    initializeResult:'pending-restart'
  };
  var p=provider(state);
  var selection=sql.selectDatabaseEngine({engine:'mysql',targetVersion:'8.4'});
  var target=await sql.inspectEngineTarget(p);
  var plan=sql.planEngineInitialization(selection,target,{dataDirectory:'/var/lib/mysql'});
  var result=await sql.executeEngineInitialization(p,plan,{approvedPlanHash:plan.planHash});
  assert.strictEqual(result.status,'pending-restart');

  var pendingTarget=await sql.inspectEngineTarget(p);
  var pendingPlan=sql.planEngineInitialization(selection,pendingTarget,{dataDirectory:'/var/lib/mysql'});
  assert.strictEqual(pendingPlan.summary.blocked,1);
  assert.strictEqual(pendingPlan.steps[0].action,'initialization-incomplete');
}

async function secretPlanRejection(){
  var state={installed:[{engine:'mysql',version:'8.4',state:'ready'}]};
  var p=provider(state);
  var selection=sql.selectDatabaseEngine({engine:'mysql',targetVersion:'8.4'});
  var target=await sql.inspectEngineTarget(p);
  assert.throws(function(){
    sql.planEngineInitialization(selection,target,{
      dataDirectory:'/var/lib/mysql',
      options:{rootPassword:'never-hash-me'}
    });
  },/must not contain secret-like option/);
}

async function providerEvidenceLeak(){
  var state={secretEvidence:true};
  var ctx=await targetAndPlan('postgresql','18',state,'package');
  var result=await sql.executeEngineInstallation(ctx.provider,ctx.plan,{
    approvedPlanHash:ctx.plan.planHash
  });
  assert.strictEqual(result.status,'failed');
  assert.match(result.error.message,/must not contain secret-like field/);
  assert.strictEqual(JSON.stringify(result).includes('leak'),false);
}

async function missingExecutor(){
  var state={};
  var p={
    id:'inspect-only',
    kind:'test',
    actions:['inspect-target','install'],
    async inspectTarget(){
      return {targetId:'host',platform:{os:'linux'},installed:state.installed||[],resources:[]};
    }
  };
  var selection=sql.selectDatabaseEngine({engine:'postgresql',targetVersion:'18'});
  var target=await sql.inspectEngineTarget(p);
  var plan=sql.planEngineInstallation(selection,target);
  var result=await sql.executeEngineInstallation(p,plan,{approvedPlanHash:plan.planHash});
  assert.strictEqual(result.status,'blocked');
  assert.match(result.reason,/does not implement executeAction/);
}

Promise.resolve()
  .then(deterministicInspection)
  .then(approvalAndDryRun)
  .then(drift)
  .then(installationSuccessAndSecrets)
  .then(externalInstall)
  .then(sqlServerLicense)
  .then(pendingReboot)
  .then(initializationSuccess)
  .then(pendingRestart)
  .then(secretPlanRejection)
  .then(providerEvidenceLeak)
  .then(missingExecutor)
  .then(function(){console.log('NuBloxSQL controlled engine lifecycle execution contract: PASS');})
  .catch(function(error){console.error(error);process.exitCode=1;});
