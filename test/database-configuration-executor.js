'use strict';

var assert=require('assert');
var sql=require('..');

function pgClient(state){
  return {
    dialect:'postgresql',
    closed:false,
    async all(statement){
      if(/FROM pg_settings/.test(statement)){
        return [
          {name:'work_mem',setting:String(state.work_mem),context:'user',source:'configuration file',pending_restart:false},
          {name:'allow_alter_system',setting:'on',context:'sighup',source:'default',pending_restart:false}
        ];
      }
      if(/FROM pg_file_settings/.test(statement)){
        if(state.persisted===null)return [];
        return [{setting:String(state.persisted),applied:true,error:null,sourcefile:'postgresql.auto.conf',sourceline:1,seqno:1}];
      }
      return [];
    },
    async execute(statement){
      state.executed.push(statement);
      var m=statement.match(/^ALTER SYSTEM SET work_mem = '([^']+)'$/);
      if(m){state.persisted=m[1];return {rows:[],rowCount:0};}
      if(statement==='SELECT pg_reload_conf()'){
        state.work_mem=state.persisted;
        return {rows:[{pg_reload_conf:true}],rowCount:1};
      }
      return {rows:[],rowCount:0};
    },
    async close(){this.closed=true;}
  };
}

function sqlServerClient(state){
  return {
    dialect:'sqlserver',
    closed:false,
    async all(statement){
      if(/sys\.configurations/.test(statement)){
        return [{
          name:'fill factor (%)',
          value:state.configured,
          value_in_use:state.effective,
          minimum:0,
          maximum:100,
          is_dynamic:false,
          is_advanced:false,
          description:'Default fill factor'
        }];
      }
      return [];
    },
    async execute(statement){
      state.executed.push(statement);
      var m=statement.match(/sp_configure N'fill factor \(%\)', (\d+)/);
      if(m)state.configured=Number(m[1]);
      return {rows:[],rowCount:0};
    },
    async close(){this.closed=true;}
  };
}

async function approvalAndDryRun(){
  var state={work_mem:'4096',persisted:null,executed:[]};
  var db=pgClient(state);
  var discovered=await sql.discoverDatabaseConfiguration(db);
  var plan=sql.planDatabaseConfiguration(discovered,{changes:[{name:'work_mem',value:'8192'}]});

  var blocked=await sql.executeDatabaseConfiguration(db,plan);
  assert.strictEqual(blocked.status,'blocked');
  assert.match(blocked.reason,/approvedPlanHash/);
  assert.strictEqual(state.executed.length,0);

  var dry=await sql.executeDatabaseConfiguration(db,plan,{dryRun:true});
  assert.strictEqual(dry.status,'dry-run');
  assert.strictEqual(dry.preflight.drift.length,0);
  assert.strictEqual(dry.audit.length,2);
  assert.strictEqual(state.executed.length,0);
}

async function postgresExecution(){
  var state={work_mem:'4096',persisted:null,executed:[]};
  var db=pgClient(state);
  var discovered=await sql.discoverDatabaseConfiguration(db);
  var plan=sql.planDatabaseConfiguration(discovered,{changes:[{name:'work_mem',value:'8192'}]});
  var result=await sql.executeDatabaseConfiguration(db,plan,{approvedPlanHash:plan.planHash});
  assert.strictEqual(result.status,'succeeded');
  assert.strictEqual(result.audit.length,2);
  assert.strictEqual(result.audit[0].verification.mode,'postgres-file-setting-equals');
  assert.strictEqual(result.audit[0].verification.ok,true);
  assert.strictEqual(result.audit[1].verification.mode,'effective-setting-equals');
  assert.strictEqual(result.audit[1].verification.ok,true);
  assert.strictEqual(state.work_mem,'8192');
}

async function driftDetection(){
  var state={work_mem:'4096',persisted:null,executed:[]};
  var db=pgClient(state);
  var discovered=await sql.discoverDatabaseConfiguration(db);
  var plan=sql.planDatabaseConfiguration(discovered,{changes:[{name:'work_mem',value:'8192'}]});
  state.work_mem='6144';

  var inspection=await sql.inspectDatabaseConfigurationPlan(db,plan);
  assert.strictEqual(inspection.drift.length,1);
  assert.strictEqual(inspection.drift[0].expected,'4096');
  assert.strictEqual(inspection.drift[0].actual,'6144');

  var result=await sql.executeDatabaseConfiguration(db,plan,{approvedPlanHash:plan.planHash});
  assert.strictEqual(result.status,'drifted');
  assert.strictEqual(state.executed.length,0);
}

async function sqlServerRestartBoundary(){
  var state={configured:0,effective:0,executed:[]};
  var db=sqlServerClient(state);
  var discovered=await sql.discoverDatabaseConfiguration(db);
  assert.strictEqual(discovered.settings[0].configuredValue,0);
  assert.strictEqual(discovered.settings[0].effectiveValue,0);
  var plan=sql.planDatabaseConfiguration(discovered,{changes:[{name:'fill factor (%)',value:80}]});

  var blocked=await sql.executeDatabaseConfiguration(db,plan,{approvedPlanHash:plan.planHash});
  assert.strictEqual(blocked.status,'blocked');
  assert.strictEqual(state.configured,80);
  assert.strictEqual(state.effective,0);
  assert.strictEqual(blocked.audit[0].verification.mode,'configured-setting-equals');
  assert.strictEqual(blocked.audit[0].verification.ok,true);

  state={configured:0,effective:0,executed:[]};
  db=sqlServerClient(state);
  discovered=await sql.discoverDatabaseConfiguration(db);
  plan=sql.planDatabaseConfiguration(discovered,{changes:[{name:'fill factor (%)',value:80}]});

  var opened=null;
  var result=await sql.executeDatabaseConfiguration(db,plan,{
    approvedPlanHash:plan.planHash,
    manualHandler:async function(context){
      assert.strictEqual(context.step.action,'restart');
      state.effective=state.configured;
    },
    openVerificationClient:async function(context){
      assert.strictEqual(context.step.action,'restart');
      opened=sqlServerClient(state);
      return opened;
    }
  });
  assert.strictEqual(result.status,'succeeded');
  assert.strictEqual(result.audit[1].verification.mode,'effective-setting-equals');
  assert.strictEqual(result.audit[1].verification.ok,true);
  assert.strictEqual(opened.closed,true);
}

async function pendingVerification(){
  var state={configured:0,effective:0,executed:[]};
  var db=sqlServerClient(state);
  var discovered=await sql.discoverDatabaseConfiguration(db);
  var plan=sql.planDatabaseConfiguration(discovered,{changes:[{name:'fill factor (%)',value:80}]});
  var result=await sql.executeDatabaseConfiguration(db,plan,{
    approvedPlanHash:plan.planHash,
    manualHandler:async function(){state.effective=state.configured;}
  });
  assert.strictEqual(result.status,'pending-verification');
  assert.strictEqual(result.audit[1].status,'pending-verification');
}

async function clientSurface(){
  var state={work_mem:'4096',persisted:null,executed:[]};
  var high=pgClient(state);
  var adapter={
    descriptor:{capabilities:{},supports:function(){return false;}},
    createConnection:function(){
      return {
        connected:true,
        async query(statement){
          var rows=await high.all(statement);
          return {rows:rows,fields:[],rowCount:rows.length};
        },
        async execute(statement){
          return high.execute(statement);
        },
        async close(){}
      };
    }
  };
  var db=new sql.Client(adapter,'postgresql',{pool:false});
  var discovered=await db.discoverConfiguration();
  var plan=db.planConfiguration(discovered,{changes:[{name:'work_mem',value:'8192'}]});
  var inspected=await db.inspectConfigurationPlan(plan);
  assert.strictEqual(inspected.drift.length,0);
  var result=await db.executeConfiguration(plan,{approvedPlanHash:plan.planHash});
  assert.strictEqual(result.status,'succeeded');
}

Promise.resolve()
  .then(approvalAndDryRun)
  .then(postgresExecution)
  .then(driftDetection)
  .then(sqlServerRestartBoundary)
  .then(pendingVerification)
  .then(clientSurface)
  .then(function(){console.log('NuBloxSQL database configuration execution contract: PASS');})
  .catch(function(error){console.error(error);process.exitCode=1;});
