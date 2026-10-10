'use strict';

var assert=require('assert');
var root=require('../../..');
var Shell=require('../lib/Shell').Shell;
var output=require('../lib/Output');
var cli=require('../lib/Cli');
var commands=require('../lib/CommandRouter');

function fakeClient(){
  return {
    dialect:'postgresql',
    config:{host:'db.local',database:'app',user:'stephen',password:'secret'},
    closed:false,
    metadata:{
      async databases(){return [{name:'app',native:{}}];},
      async schemas(options){return [{database:options&&options.database||'app',name:'public',native:{}}];},
      async tables(options){return [{database:'app',schema:options&&options.schema||'public',name:'users',type:'table',native:{}}];},
      async table(name){return name==='users'?{database:'app',schema:'public',name:'users',type:'table',native:{}}:null;},
      async columns(name){return [{database:'app',schema:'public',table:name,name:'id',ordinal:1,dataType:'integer',nativeType:'int4',nullable:false,default:null,primaryKey:true,generated:false,native:{}}];},
      async indexes(name){return [{database:'app',schema:'public',table:name,name:'users_pkey',unique:true,primary:true,method:'btree',columns:['id'],native:{}}];},
      async foreignKeys(){return [];},
      async constraints(name){return [{database:'app',schema:'public',table:name,name:'users_pkey',type:'PRIMARY KEY',columns:['id'],definition:null,native:{}}];}
    },
    async discoverServer(){
      return {schemaVersion:1,dialect:'postgresql',identity:{product:'PostgreSQL',version:'18'},databases:[{name:'app'}]};
    },
    async discoverConfiguration(){
      return {schemaVersion:1,dialect:'postgresql',settings:[{name:'work_mem',value:'4096'}],summary:{settings:1}};
    },
    async query(statement){
      return {rows:[{answer:42,statement:statement}],fields:[],rowCount:1,affectedRows:null,insertId:null,command:'SELECT',dialect:'postgresql',native:{}};
    },
    async close(){this.closed=true;}
  };
}
function apiFor(client){
  return {
    createClient:function(){return client;},
    findDatabaseConfiguration:function(report,name){
      return report.settings.find(function(item){return item.name.toLowerCase()===name.toLowerCase();})||null;
    }
  };
}

async function shellCommands(){
  var client=fakeClient();
  var shell=new Shell({sqlApi:apiFor(client),client:client});
  assert.strictEqual(shell.prompt(),'postgresql/app> ');

  var connection=await shell.executeLine('\\connection');
  assert.strictEqual(connection.value.config.password,'********');
  assert.strictEqual(connection.value.config.database,'app');

  var server=await shell.executeLine('\\server');
  assert.strictEqual(server.value.identity.product,'PostgreSQL');

  var dbs=await shell.executeLine('\\databases');
  assert.strictEqual(dbs.value[0].name,'app');

  var schemas=await shell.executeLine('\\schemas app');
  assert.strictEqual(schemas.value[0].name,'public');

  var tables=await shell.executeLine('\\tables public');
  assert.strictEqual(tables.value[0].name,'users');

  var description=await shell.executeLine('\\describe users');
  assert.strictEqual(description.value.columns[0].name,'id');
  assert.strictEqual(description.value.indexes[0].primary,true);

  var config=await shell.executeLine('\\config work_mem');
  assert.strictEqual(config.value.value,'4096');

  var sqlResult=await shell.executeLine('SELECT 42;');
  assert.strictEqual(sqlResult.value[0].answer,42);

  var format=await shell.executeLine('\\format json');
  assert.strictEqual(format.value,'Output format: json');
  assert.match(shell.render(sqlResult),/"answer": 42/);

  var quit=await shell.executeLine('\\quit');
  assert.strictEqual(quit.kind,'quit');
}

function outputContracts(){
  var rows=[{id:1,name:'Alpha'},{id:2,name:'Beta, Ltd'}];
  var table=output.render(rows,'table');
  assert.match(table,/Alpha/);
  assert.match(table,/\(2 rows\)/);
  var json=output.render(rows,'json');
  assert.strictEqual(JSON.parse(json)[1].name,'Beta, Ltd');
  var jsonl=output.render(rows,'jsonl').split('\n');
  assert.strictEqual(jsonl.length,2);
  var csv=output.render(rows,'csv');
  assert.match(csv,/"Beta, Ltd"/);
}

function cliContracts(){
  var parsed=cli.parseArgs([
    '--dialect','sqlite','--filename',':memory:','--format','json',
    '--option','busyTimeout=5000','--no-pool','--execute','SELECT 1;'
  ]);
  assert.strictEqual(parsed.dialect,'sqlite');
  assert.strictEqual(parsed.extra.busyTimeout,5000);
  assert.strictEqual(parsed.pool,false);
  var connection=cli.connectionFrom(parsed,{NUBLOX_PASSWORD:'hidden'});
  assert.strictEqual(connection.filename,':memory:');
  assert.strictEqual(connection.password,'hidden');
  assert.throws(function(){cli.parseArgs(['--execute','x','--command','tables']);},/only one of --execute, --command, --demo, or --doctor/);
  assert.strictEqual(cli.parseArgs(['--demo']).demo,true);
  assert.strictEqual(cli.parseArgs(['--doctor']).doctor,true);
  assert.throws(function(){cli.parseArgs(['--demo','--doctor']);},/only one of/);
  assert.throws(function(){cli.parseArgs(['--format','xml']);},/output format/);
  assert.deepStrictEqual(commands.tokenize('describe "order items"'),['describe','order items']);
}

async function cliExecution(){
  var client=fakeClient();
  var stdout='',stderr='';
  var io={
    stdout:{write:function(value){stdout+=value;}},
    stderr:{write:function(value){stderr+=value;}},
    stdin:{isTTY:false}
  };
  var code=await cli.run(
    ['--dialect','postgresql','--host','db.local','--database','app','--execute','SELECT 42;','--format','json'],
    io,{},apiFor(client)
  );
  assert.strictEqual(code,0);
  assert.match(stdout,/"answer": 42/);
  assert.strictEqual(stderr,'');
  assert.strictEqual(client.closed,true);
}

assert.strictEqual(typeof root.createClient,'function');
Promise.resolve()
  .then(shellCommands)
  .then(outputContracts)
  .then(cliContracts)
  .then(cliExecution)
  .then(function(){console.log('NuBlox Shell v0.1 contract: PASS');})
  .catch(function(error){console.error(error);process.exitCode=1;});
