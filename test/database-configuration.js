'use strict';

var assert=require('assert');
var sql=require('..');

function client(dialect,handler){
  return {dialect:dialect,all:handler};
}

async function postgresql(){
  var db=client('postgresql',async function(statement){
    assert.ok(/pg_settings/.test(statement));
    return [
      {name:'shared_buffers',setting:'16384',context:'postmaster',source:'configuration file',short_desc:'Sets the number of shared memory buffers.',pending_restart:false},
      {name:'work_mem',setting:'4096',context:'user',source:'default',short_desc:'Sets the maximum memory to be used for query workspaces.',pending_restart:false},
      {name:'max_connections',setting:'100',context:'postmaster',source:'configuration file',short_desc:'Sets the maximum number of concurrent connections.',pending_restart:true}
    ];
  });
  var report=await sql.discoverDatabaseConfiguration(db);
  assert.strictEqual(report.schemaVersion,1);
  assert.strictEqual(report.dialect,'postgresql');
  assert.strictEqual(report.settings.length,3);
  assert.strictEqual(sql.findDatabaseConfiguration(report,'shared_buffers').apply,'restart');
  assert.strictEqual(sql.findDatabaseConfiguration(report,'work_mem').scope,'session');
  assert.strictEqual(sql.findDatabaseConfiguration(report,'max_connections').restartRequired,true);
}

async function mysql(){
  var db=client('mysql',async function(statement){
    assert.strictEqual(statement,'SHOW GLOBAL VARIABLES');
    return [
      {Variable_name:'max_connections',Value:'151'},
      {Variable_name:'sql_mode',Value:'STRICT_TRANS_TABLES'}
    ];
  });
  var report=await sql.discoverDatabaseConfiguration(db);
  assert.strictEqual(report.settings[0].scope,'server');
  assert.strictEqual(report.settings[0].apply,'unknown');
  assert.strictEqual(report.settings[0].mutable,null);
  assert.strictEqual(report.summary.unknownMutability,2);
}

async function sqlserver(){
  var db=client('sqlserver',async function(statement){
    assert.ok(/sys\.configurations/.test(statement));
    return [
      {name:'max degree of parallelism',value:0,value_in_use:0,is_dynamic:true,is_advanced:true,description:'Maximum degree of parallelism'},
      {name:'affinity mask',value:0,value_in_use:0,is_dynamic:false,is_advanced:true,description:'Affinity mask'}
    ];
  });
  var report=await sql.discoverDatabaseConfiguration(db);
  assert.strictEqual(report.settings[0].apply,'immediate');
  assert.strictEqual(report.settings[0].restartRequired,false);
  assert.strictEqual(report.settings[1].apply,'restart');
  assert.strictEqual(report.settings[1].mutable,true);
  assert.strictEqual(report.settings[1].restartRequired,true);
}

async function sqlite(){
  var seen=[];
  var db=client('sqlite',async function(statement){
    seen.push(statement);
    var name=statement.slice('PRAGMA '.length);
    var row={};
    row[name]=name==='foreign_keys'?1:0;
    return [row];
  });
  var report=await sql.discoverDatabaseConfiguration(db);
  assert.ok(report.settings.length>=10);
  assert.strictEqual(sql.findDatabaseConfiguration(report,'foreign_keys').scope,'connection');
  assert.strictEqual(sql.findDatabaseConfiguration(report,'page_size').scope,'database');
  assert.ok(seen.indexOf('PRAGMA journal_mode')>=0);
}

async function clientSurface(){
  var adapter={
    descriptor:{capabilities:{},supports:function(){return false;}},
    createConnection:function(){
      return {
        connected:true,
        async query(statement){
          var rows=/pg_settings/.test(statement)?[{name:'work_mem',setting:'4096',context:'user',source:'default',pending_restart:false}]:[];
          return {rows:rows,fields:[],rowCount:rows.length};
        },
        async close(){}
      };
    }
  };
  var db=new sql.Client(adapter,'postgresql',{pool:false});
  var report=await db.discoverConfiguration();
  assert.strictEqual(report.settings[0].name,'work_mem');
}

Promise.resolve()
  .then(postgresql)
  .then(mysql)
  .then(sqlserver)
  .then(sqlite)
  .then(clientSurface)
  .then(function(){console.log('NuBloxSQL database configuration discovery contract: PASS');})
  .catch(function(error){console.error(error);process.exitCode=1;});
