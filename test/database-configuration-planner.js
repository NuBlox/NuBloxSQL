'use strict';

var assert=require('assert');
var sql=require('..');

function report(dialect,settings){
  return Object.freeze({
    schemaVersion:sql.DATABASE_CONFIGURATION_DISCOVERY_SCHEMA_VERSION,
    dialect:dialect,
    settings:Object.freeze(settings.map(function(x){return Object.freeze(x);})),
    summary:Object.freeze({settings:settings.length,mutable:0,immutable:0,restartRequired:0,unknownMutability:0})
  });
}

function setting(name,value,scope,apply,mutable,native){
  return {
    name:name,value:value,scope:scope,apply:apply,mutable:mutable,
    restartRequired:apply==='restart',source:null,description:null,native:native||{}
  };
}

function postgresql(){
  var discovered=report('postgresql',[
    setting('work_mem','4096','session','immediate',true,{context:'user'}),
    setting('shared_buffers','16384','server','restart',true,{context:'postmaster'}),
    setting('server_version','18.0','server','immutable',false,{context:'internal'})
  ]);
  var plan=sql.planDatabaseConfiguration(discovered,{changes:[
    {name:'work_mem',value:'8192'},
    {name:'shared_buffers',value:'32768'}
  ]});
  assert.strictEqual(plan.targetDialect,'postgresql');
  assert.strictEqual(plan.summary.automatic,3);
  assert.strictEqual(plan.summary.manual,1);
  assert.strictEqual(plan.executable,false);
  assert.strictEqual(plan.requires.reload,true);
  assert.strictEqual(plan.requires.restart,true);
  assert.strictEqual(plan.steps[0].sql,"ALTER SYSTEM SET work_mem = '8192'");
  assert.strictEqual(plan.steps[1].sql,'SELECT pg_reload_conf()');
  assert.strictEqual(plan.steps[2].sql,"ALTER SYSTEM SET shared_buffers = '32768'");
  assert.strictEqual(plan.steps[3].action,'restart');
  assert.strictEqual(plan.steps[3].execution,'manual');
  assert.strictEqual(typeof plan.planHash,'string');
  assert.strictEqual(plan.planHash.length,64);

  assert.throws(function(){
    sql.planDatabaseConfiguration(discovered,{changes:[{name:'server_version',value:'19'}]});
  },/immutable/);
}

function mysql(){
  var discovered=report('mysql',[
    setting('max_connections','151','server','unknown',null,{Variable_name:'max_connections',Value:'151'})
  ]);
  var plan=sql.planDatabaseConfiguration(discovered,{changes:[{name:'max_connections',value:300}]});
  assert.strictEqual(plan.summary.manual,1);
  assert.strictEqual(plan.executable,false);
  assert.strictEqual(plan.steps[0].sql,null);
  assert.match(plan.steps[0].notes,/SET GLOBAL, SET PERSIST or SET PERSIST_ONLY/);
}

function sqlserver(){
  var discovered=report('sqlserver',[
    setting('max degree of parallelism',0,'server','immediate',true,{minimum:0,maximum:32767,is_dynamic:true}),
    setting('fill factor (%)',0,'server','restart',true,{minimum:0,maximum:100,is_dynamic:false})
  ]);
  var dynamic=sql.planDatabaseConfiguration(discovered,{changes:[{name:'max degree of parallelism',value:4}]});
  assert.strictEqual(dynamic.executable,true);
  assert.strictEqual(dynamic.steps.length,1);
  assert.strictEqual(dynamic.steps[0].sql,"EXEC sys.sp_configure N'max degree of parallelism', 4; RECONFIGURE");

  var restart=sql.planDatabaseConfiguration(discovered,{changes:[{name:'fill factor (%)',value:80}]});
  assert.strictEqual(restart.summary.automatic,1);
  assert.strictEqual(restart.summary.manual,1);
  assert.strictEqual(restart.requires.restart,true);
  assert.throws(function(){
    sql.planDatabaseConfiguration(discovered,{changes:[{name:'fill factor (%)',value:101}]});
  },/exceeds maximum 100/);

  var advancedOff=report('sqlserver',[
    setting('show advanced options',0,'server','immediate',true,{minimum:0,maximum:1,is_dynamic:true,is_advanced:false}),
    setting('cost threshold for parallelism',5,'server','immediate',true,{minimum:0,maximum:32767,is_dynamic:true,is_advanced:true})
  ]);
  var advancedPlan=sql.planDatabaseConfiguration(advancedOff,{changes:[{name:'cost threshold for parallelism',value:25}]});
  assert.strictEqual(advancedPlan.steps[0].execution,'manual');
  assert.match(advancedPlan.steps[0].notes,/advanced configuration option/);

  var advancedOn=report('sqlserver',[
    setting('show advanced options',1,'server','immediate',true,{minimum:0,maximum:1,is_dynamic:true,is_advanced:false}),
    setting('cost threshold for parallelism',5,'server','immediate',true,{minimum:0,maximum:32767,is_dynamic:true,is_advanced:true})
  ]);
  var advancedAuto=sql.planDatabaseConfiguration(advancedOn,{changes:[{name:'cost threshold for parallelism',value:25}]});
  assert.strictEqual(advancedAuto.steps[0].execution,'automatic');
}

function sqlite(){
  var discovered=report('sqlite',[
    setting('foreign_keys',0,'connection','immediate',true,{}),
    setting('page_size',4096,'database','unknown',true,{})
  ]);
  var fk=sql.planDatabaseConfiguration(discovered,{changes:[{name:'foreign_keys',value:1}]});
  assert.strictEqual(fk.executable,true);
  assert.strictEqual(fk.steps[0].sql,'PRAGMA foreign_keys = 1');
  assert.strictEqual(fk.requires.transactionBoundary,true);

  var page=sql.planDatabaseConfiguration(discovered,{changes:[{name:'page_size',value:8192}]});
  assert.strictEqual(page.executable,false);
  assert.strictEqual(page.steps[0].execution,'manual');
}

function common(){
  var discovered=report('postgresql',[setting('work_mem','4096','session','immediate',true,{context:'user'})]);
  var same=sql.planDatabaseConfiguration(discovered,{changes:[{name:'work_mem',value:'4096'}]});
  assert.strictEqual(same.summary.satisfied,1);
  assert.strictEqual(same.steps[0].execution,'satisfied');
  assert.strictEqual(sql.configurationAutomaticSteps(same).length,0);
  assert.strictEqual(sql.configurationManualSteps(same).length,0);
  assert.throws(function(){
    sql.planDatabaseConfiguration(discovered,{changes:[{name:'missing',value:1}]});
  },/was not found/);
  assert.throws(function(){
    sql.planDatabaseConfiguration(discovered,{changes:[{name:'work_mem',value:null}]});
  },/value must be a string, number or boolean/);
}

postgresql();
mysql();
sqlserver();
sqlite();
function clientSurface(){
  var adapter={
    descriptor:{capabilities:{},supports:function(){return false;}},
    createConnection:function(){return {connected:true,async close(){}};}
  };
  var db=new sql.Client(adapter,'postgresql',{pool:false});
  var discovered=report('postgresql',[
    setting('work_mem','4096','session','immediate',true,{context:'user'})
  ]);
  var plan=db.planConfiguration(discovered,{changes:[{name:'work_mem',value:'8192'}]});
  assert.strictEqual(plan.targetDialect,'postgresql');
  assert.strictEqual(plan.steps[0].action,'set');
}

common();
clientSurface();
console.log('NuBloxSQL database configuration change planner contract: PASS');
