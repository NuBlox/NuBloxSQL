'use strict';

var assert = require('assert');
var sql = require('..');

function createdName(statement,keyword){
  var text=statement.replace(new RegExp('^CREATE\\s+'+keyword+'\\s+','i'),'').replace(/^IF NOT EXISTS\s+/i,'').trim();
  var tick=String.fromCharCode(96);
  if(text.charAt(0)===tick&&text.charAt(text.length-1)===tick)return text.slice(1,-1).split(tick+tick).join(tick);
  if(text.charAt(0)==='"'&&text.charAt(text.length-1)==='"')return text.slice(1,-1).replace(/""/g,'"');
  if(text.charAt(0)==='['&&text.charAt(text.length-1)===']')return text.slice(1,-1).replace(/\]\]/g,']');
  return text.replace(/;$/,'');
}

function fakeClient(dialect,state,scope){
  state=state||{databases:Object.create(null),schemas:Object.create(null),executed:[]};
  scope=scope||'server';
  return {
    dialect:dialect,
    closed:false,
    state:state,
    async all(statement){
      if(/pg_database|information_schema\.SCHEMATA|sys\.databases/.test(statement)){
        var names=Object.keys(state.databases);
        return names.some(function(name){return statement.indexOf(name)!==-1;})?[{exists:1}]:[];
      }
      if(/information_schema\.schemata|sys\.schemas/.test(statement)){
        var schemaNames=Object.keys(state.schemas);
        return schemaNames.some(function(name){return statement.indexOf(name)!==-1;})?[{exists:1}]:[];
      }
      return [];
    },
    async execute(statement){
      state.executed.push({scope:scope,sql:statement});
      if(/^CREATE DATABASE /i.test(statement)){
        state.databases[createdName(statement,'DATABASE')]=true;
      }else if(/^CREATE SCHEMA /i.test(statement)){
        var name=createdName(statement,'SCHEMA');
        if(dialect==='mysql')state.databases[name]=true;
        else state.schemas[name]=true;
      }
      return {rows:[],rowCount:0};
    },
    async close(){this.closed=true;}
  };
}

async function plannerContracts(){
  var pg=sql.planDatabaseBootstrap({
    database:'app',
    schemas:['app']
  },{targetDialect:'postgresql'});
  assert.strictEqual(pg.schemaVersion,1);
  assert.strictEqual(pg.targetDialect,'postgresql');
  assert.strictEqual(pg.summary.steps,2);
  assert.strictEqual(pg.summary.automatic,2);
  assert.strictEqual(pg.requires.databaseClientAfterCreate,true);
  assert.strictEqual(pg.requires.autocommitBoundary,true);
  assert.ok(/^CREATE DATABASE "app"$/.test(pg.steps[0].sql));
  assert.ok(/^CREATE SCHEMA IF NOT EXISTS "app"$/.test(pg.steps[1].sql));
  assert.strictEqual(pg.steps[0].requirements.transactionForbidden,true);
  assert.strictEqual(pg.steps[1].scope,'database');
  assert.strictEqual(typeof pg.planHash,'string');
  assert.strictEqual(pg.planHash.length,64);

  var tick=String.fromCharCode(96);
  var my=sql.planDatabaseBootstrap({
    database:'app',
    schemas:['app','analytics']
  },{targetDialect:'mysql'});
  assert.strictEqual(my.summary.automatic,2);
  assert.strictEqual(my.summary.satisfied,1);
  assert.strictEqual(my.requires.databaseClientAfterCreate,false);
  assert.strictEqual(my.steps[1].execution,'satisfied');
  assert.strictEqual(my.steps[2].scope,'server');
  assert.strictEqual(my.steps[2].requirements.databaseEquivalent,true);
  assert.strictEqual(my.steps[2].sql,'CREATE SCHEMA IF NOT EXISTS '+tick+'analytics'+tick);

  var ms=sql.planDatabaseBootstrap({
    database:'app',
    schemas:['app']
  },{targetDialect:'sqlserver'});
  assert.strictEqual(ms.summary.automatic,2);
  assert.strictEqual(ms.requires.databaseClientAfterCreate,true);
  assert.strictEqual(ms.steps[0].requirements.onlyStatementBatch,true);
  assert.strictEqual(ms.steps[0].requirements.transactionForbidden,true);
  assert.strictEqual(ms.steps[0].sql,'CREATE DATABASE [app]');
  assert.strictEqual(ms.steps[1].sql,'CREATE SCHEMA [app]');

  var sq=sql.planDatabaseBootstrap({
    database:'app.db',
    schemas:['aux']
  },{targetDialect:'sqlite'});
  assert.strictEqual(sq.summary.satisfied,1);
  assert.strictEqual(sq.summary.manual,1);
  assert.strictEqual(sq.executable,false);
  assert.strictEqual(sq.steps[0].execution,'satisfied');
  assert.strictEqual(sq.steps[1].execution,'manual');

  var escaped=sql.planDatabaseBootstrap({database:'a"b'},{targetDialect:'postgresql'});
  assert.strictEqual(escaped.steps[0].sql,'CREATE DATABASE "a""b"');

  assert.throws(function(){
    sql.planDatabaseBootstrap({database:'app',schemas:['x','x']},{targetDialect:'postgresql'});
  },/duplicate schema/);
}

async function inspectionAndDryRun(){
  var plan=sql.planDatabaseBootstrap({database:'app'},{targetDialect:'postgresql'});
  var state={databases:Object.create(null),schemas:Object.create(null),executed:[]};
  var server=fakeClient('postgresql',state,'server');

  var before=await sql.inspectDatabaseBootstrap(server,plan);
  assert.strictEqual(before.summary.needed,1);
  assert.strictEqual(before.findings[0].status,'needed');

  var dry=await sql.executeDatabaseBootstrap(server,plan,{dryRun:true});
  assert.strictEqual(dry.status,'dry-run');
  assert.strictEqual(dry.audit[0].status,'planned');
  assert.deepStrictEqual(state.executed,[]);
}

async function postgresqlTwoScopeExecution(){
  var plan=sql.planDatabaseBootstrap({
    database:'app',
    schemas:['app']
  },{targetDialect:'postgresql'});
  var state={databases:Object.create(null),schemas:Object.create(null),executed:[]};
  var server=fakeClient('postgresql',state,'server');

  var blocked=await sql.executeDatabaseBootstrap(server,plan);
  assert.strictEqual(blocked.status,'blocked');
  assert.strictEqual(blocked.audit.length,0);
  assert.strictEqual(state.executed.length,0);

  var opened=null;
  var result=await sql.executeDatabaseBootstrap(server,plan,{
    openDatabaseClient:async function(context){
      assert.strictEqual(context.targetDatabase,'app');
      assert.strictEqual(Object.isFrozen(context),true);
      assert.strictEqual(Object.isFrozen(context.serverClient),false);
      assert.strictEqual(Object.isFrozen(state),false);
      opened=fakeClient('postgresql',state,'database');
      return opened;
    }
  });

  assert.strictEqual(result.status,'succeeded');
  assert.strictEqual(result.audit.length,2);
  assert.strictEqual(result.audit[0].status,'succeeded');
  assert.strictEqual(result.audit[1].status,'succeeded');
  assert.strictEqual(state.databases.app,true);
  assert.strictEqual(state.schemas.app,true);
  assert.strictEqual(state.executed.length,2);
  assert.strictEqual(state.executed[0].scope,'server');
  assert.strictEqual(state.executed[1].scope,'database');
  assert.strictEqual(opened.closed,true);

  var rerunOpened=null;
  var rerun=await sql.executeDatabaseBootstrap(server,plan,{
    openDatabaseClient:async function(context){
      assert.strictEqual(Object.isFrozen(context.serverClient),false);
      rerunOpened=fakeClient('postgresql',state,'database');
      return rerunOpened;
    }
  });
  assert.strictEqual(rerun.status,'succeeded');
  assert.strictEqual(rerun.audit[0].status,'skipped');
  assert.strictEqual(rerun.audit[1].status,'skipped');
  assert.strictEqual(state.executed.length,2);
  assert.strictEqual(rerunOpened.closed,true);
}

async function mysqlAndSqliteExecution(){
  var myPlan=sql.planDatabaseBootstrap({
    database:'app',
    schemas:['app','analytics']
  },{targetDialect:'mysql'});
  var myState={databases:Object.create(null),schemas:Object.create(null),executed:[]};
  var my=fakeClient('mysql',myState,'server');
  var myResult=await sql.executeDatabaseBootstrap(my,myPlan);
  assert.strictEqual(myResult.status,'succeeded');
  assert.strictEqual(myResult.audit[0].status,'succeeded');
  assert.strictEqual(myResult.audit[1].status,'satisfied');
  assert.strictEqual(myResult.audit[2].status,'succeeded');
  assert.strictEqual(myState.databases.app,true);
  assert.strictEqual(myState.databases.analytics,true);

  var sqlitePlan=sql.planDatabaseBootstrap({
    database:'app.db',
    schemas:['aux']
  },{targetDialect:'sqlite'});
  var sqlite=fakeClient('sqlite',{databases:Object.create(null),schemas:Object.create(null),executed:[]},'database');
  var blocked=await sql.executeDatabaseBootstrap(sqlite,sqlitePlan);
  assert.strictEqual(blocked.status,'blocked');
  assert.strictEqual(blocked.audit[0].status,'satisfied');
  assert.strictEqual(blocked.audit[1].status,'blocked');

  var handled=false;
  var handledResult=await sql.executeDatabaseBootstrap(sqlite,sqlitePlan,{
    manualHandler:async function(context){
      handled=true;
      assert.strictEqual(context.step.kind,'schema');
    }
  });
  assert.strictEqual(handled,true);
  assert.strictEqual(handledResult.status,'succeeded');
}

async function clientSurface(){
  var state={databases:Object.create(null),schemas:Object.create(null),executed:[]};
  var adapter={
    descriptor:{capabilities:{},supports:function(){return false;}},
    createConnection:function(){return fakeClient('postgresql',state,'server');}
  };
  var client=new sql.Client(adapter,'postgresql',{pool:false});
  var plan=client.planBootstrap({database:'client_db'});
  assert.strictEqual(plan.targetDialect,'postgresql');
  var inspected=await client.inspectBootstrap(plan);
  assert.strictEqual(inspected.findings[0].status,'needed');
  var result=await client.executeBootstrap(plan);
  assert.strictEqual(result.status,'succeeded');
  assert.strictEqual(state.databases.client_db,true);
}

Promise.resolve()
  .then(plannerContracts)
  .then(inspectionAndDryRun)
  .then(postgresqlTwoScopeExecution)
  .then(mysqlAndSqliteExecution)
  .then(clientSurface)
  .then(function(){console.log('NuBloxSQL database bootstrap foundation contract: PASS');})
  .catch(function(error){console.error(error);process.exitCode=1;});
