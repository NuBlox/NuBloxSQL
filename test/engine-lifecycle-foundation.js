'use strict';

var assert=require('assert');
var sql=require('..');

function provider(state){
  state=state||{};
  return {
    id:'test-provider',
    kind:'test',
    actions:[
      'inspect-target','install','verify-install','initialize','verify-initialize'
    ],
    metadata:{test:true},
    async inspectTarget(){
      return {
        targetId:'test-host',
        platform:{os:'linux',family:'debian',version:'13',architecture:'arm64'},
        elevated:false,
        installed:state.installed||[],
        resources:state.resources||[],
        facts:{source:'test'}
      };
    }
  };
}

async function selection(){
  var selected=sql.selectDatabaseEngine({
    engine:'postgres',
    targetVersion:'18',
    distribution:'community',
    installationStrategy:'package',
    components:['server']
  });
  assert.strictEqual(selected.engine,'postgresql');
  assert.strictEqual(selected.runtimeKind,'server');
  assert.strictEqual(selected.initializationModel,'cluster');
  assert.strictEqual(selected.selectionHash.length,64);
  assert.strictEqual(sql.engineLifecycleProfile('pg').initializationAction,'initialize-cluster');
  assert.throws(function(){
    sql.selectDatabaseEngine({engine:'postgresql',targetVersion:'18',installationStrategy:'setup'});
  },/installation strategy/);
}

async function targetInspection(){
  var p=provider({
    installed:[{engine:'postgresql',version:'18',components:['server']}],
    resources:[{engine:'postgresql',key:'cluster:\/var\/lib\/postgresql\/18\/main',state:'ready'}]
  });
  var target=await sql.inspectEngineTarget(p,{purpose:'test'});
  assert.strictEqual(target.provider.id,'test-provider');
  assert.strictEqual(target.platform.os,'linux');
  assert.strictEqual(target.installed[0].engine,'postgresql');
  assert.strictEqual(target.installed[0].version,'18');
  assert.strictEqual(target.resources[0].state,'ready');
  assert.strictEqual(sql.installationProviderDescriptor(p).actions.length,5);
}

async function freshInstall(){
  var selected=sql.selectDatabaseEngine({
    engine:'postgresql',targetVersion:'18',installationStrategy:'package'
  });
  var target=await sql.inspectEngineTarget(provider());
  var plan=sql.planEngineInstallation(selected,target);
  assert.strictEqual(plan.executable,true);
  assert.strictEqual(plan.summary.provider,2);
  assert.strictEqual(plan.summary.blocked,0);
  assert.strictEqual(plan.steps[0].action,'install-runtime');
  assert.strictEqual(plan.steps[1].action,'verify-install');
  assert.strictEqual(sql.engineInstallationProviderSteps(plan).length,2);
  assert.strictEqual(sql.engineInstallationExternalSteps(plan).length,0);
}

async function installedAndUpgrade(){
  var exact=sql.selectDatabaseEngine({engine:'mysql',targetVersion:'8.4',installationStrategy:'package'});
  var target=await sql.inspectEngineTarget(provider({installed:[{engine:'mysql',version:'8.4'}]}));
  var satisfied=sql.planEngineInstallation(exact,target);
  assert.strictEqual(satisfied.summary.satisfied,2);
  assert.strictEqual(satisfied.executable,true);

  var newer=sql.selectDatabaseEngine({engine:'mysql',targetVersion:'9.7',installationStrategy:'package'});
  var blocked=sql.planEngineInstallation(newer,target);
  assert.strictEqual(blocked.executable,false);
  assert.strictEqual(blocked.summary.blocked,1);
  assert.strictEqual(blocked.steps[0].action,'upgrade-required');

  var sideBySide=sql.planEngineInstallation(newer,target,{allowSideBySide:true});
  assert.strictEqual(sideBySide.summary.provider,2);
}

async function initialization(){
  var selected=sql.selectDatabaseEngine({engine:'postgresql',targetVersion:'18'});
  var missing=await sql.inspectEngineTarget(provider());
  var blocked=sql.planEngineInitialization(selected,missing,{dataDirectory:'/var/lib/postgresql/18/main'});
  assert.strictEqual(blocked.summary.blocked,1);

  var installed=await sql.inspectEngineTarget(provider({
    installed:[{engine:'postgresql',version:'18'}]
  }));
  var plan=sql.planEngineInitialization(selected,installed,{dataDirectory:'/var/lib/postgresql/18/main'});
  assert.strictEqual(plan.executable,true);
  assert.strictEqual(plan.resourceKey,'cluster:/var/lib/postgresql/18/main');
  assert.strictEqual(plan.summary.provider,2);

  var ready=await sql.inspectEngineTarget(provider({
    installed:[{engine:'postgresql',version:'18'}],
    resources:[{engine:'postgresql',key:'cluster:/var/lib/postgresql/18/main',state:'ready'}]
  }));
  var satisfied=sql.planEngineInitialization(selected,ready,{dataDirectory:'/var/lib/postgresql/18/main'});
  assert.strictEqual(satisfied.summary.satisfied,2);

  var mysql=sql.selectDatabaseEngine({engine:'mysql',targetVersion:'8.4'});
  var mysqlTarget=await sql.inspectEngineTarget(provider({installed:[{engine:'mysql',version:'8.4'}]}));
  var insecure=sql.planEngineInitialization(mysql,mysqlTarget,{
    dataDirectory:'/var/lib/mysql',
    secureBootstrap:false
  });
  assert.strictEqual(insecure.requires.secureBootstrap,false);
  assert.match(insecure.steps[0].notes,/insecure initialization/);

  var sqlserver=sql.selectDatabaseEngine({engine:'sqlserver',targetVersion:'2025',installationStrategy:'setup'});
  var sqlserverTarget=await sql.inspectEngineTarget(provider({installed:[{engine:'sqlserver',version:'2025'}]}));
  var instance=sql.planEngineInitialization(sqlserver,sqlserverTarget,{instanceName:'MSSQLSERVER'});
  assert.strictEqual(instance.resourceKey,'instance:MSSQLSERVER');

  var sqlite=sql.selectDatabaseEngine({engine:'sqlite',targetVersion:'3.53.4',installationStrategy:'embedded'});
  var sqliteTarget=await sql.inspectEngineTarget(provider({installed:[{engine:'sqlite',version:'3.53.4'}]}));
  var file=sql.planEngineInitialization(sqlite,sqliteTarget,{filename:'app.db'});
  assert.strictEqual(file.resourceKey,'database-file:app.db');
  assert.strictEqual(file.requires.serviceStartOrRestart,false);
}

async function externalBoundary(){
  var p={
    id:'manual-target',
    kind:'manual',
    actions:['inspect-target'],
    async inspectTarget(){
      return {targetId:'manual',platform:{os:'linux'},installed:[],resources:[]};
    }
  };
  var selected=sql.selectDatabaseEngine({engine:'postgresql',targetVersion:'18'});
  var target=await sql.inspectEngineTarget(p);
  var plan=sql.planEngineInstallation(selected,target);
  assert.strictEqual(plan.executable,false);
  assert.strictEqual(plan.summary.external,2);
}

Promise.resolve()
  .then(selection)
  .then(targetInspection)
  .then(freshInstall)
  .then(installedAndUpgrade)
  .then(initialization)
  .then(externalBoundary)
  .then(function(){console.log('NuBloxSQL engine lifecycle foundation contract: PASS');})
  .catch(function(error){console.error(error);process.exitCode=1;});
