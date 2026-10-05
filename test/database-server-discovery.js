'use strict';

var assert=require('assert');
var sql=require('..');

function fakeClient(dialect,rows){
  return {
    dialect:dialect,
    calls:[],
    async all(statement){
      this.calls.push(statement);
      if(/server_version|VERSION\(\)|sqlite_version|SERVERPROPERTY/.test(statement))return rows.identity;
      if(/pg_database|SCHEMATA|database_list|sys\.databases/.test(statement))return rows.databases;
      return [];
    }
  };
}

async function postgresqlDiscovery(){
  var client=fakeClient('postgresql',{
    identity:[{version:'18.0',current_database:'postgres',current_user:'admin'}],
    databases:[
      {name:'postgres',accessible:true,is_template:false},
      {name:'template0',accessible:false,is_template:true}
    ]
  });
  var report=await sql.discoverDatabaseServer(client);
  assert.strictEqual(report.schemaVersion,1);
  assert.strictEqual(report.dialect,'postgresql');
  assert.strictEqual(report.identity.product,'PostgreSQL');
  assert.strictEqual(report.identity.version,'18.0');
  assert.strictEqual(report.identity.currentDatabase,'postgres');
  assert.strictEqual(report.databases.length,2);
  assert.strictEqual(report.databases[1].kind,'template');
  assert.strictEqual(report.summary.accessible,1);
  assert.strictEqual(report.summary.inaccessible,1);
  assert.strictEqual(Object.isFrozen(report),true);
}

async function otherDialects(){
  var mysql=await sql.discoverDatabaseServer(fakeClient('mysql',{
    identity:[{version:'9.7.0',current_database:null,current_user:'root@localhost'}],
    databases:[{name:'app',character_set:'utf8mb4',collation:'utf8mb4_0900_ai_ci'}]
  }));
  assert.strictEqual(mysql.identity.product,'MySQL');
  assert.strictEqual(mysql.databases[0].name,'app');
  assert.strictEqual(mysql.databases[0].accessible,null);

  var sqlite=await sql.discoverDatabaseServer(fakeClient('sqlite',{
    identity:[{version:'3.49.0'}],
    databases:[{seq:0,name:'main',file:'/tmp/app.db'}]
  }));
  assert.strictEqual(sqlite.identity.currentDatabase,'main');
  assert.strictEqual(sqlite.databases[0].kind,'attached-database');

  var sqlserver=await sql.discoverDatabaseServer(fakeClient('sqlserver',{
    identity:[{version:'17.0.1000.1',edition:'Developer Edition',server_name:'localhost',current_database:'master',current_user:'sa'}],
    databases:[{name:'master',state_desc:'ONLINE',user_access_desc:'MULTI_USER',is_read_only:false}]
  }));
  assert.strictEqual(sqlserver.identity.product,'SQL Server');
  assert.strictEqual(sqlserver.identity.edition,'Developer Edition');
  assert.strictEqual(sqlserver.databases[0].accessible,true);
}

async function prerequisiteAssessment(){
  var client=fakeClient('postgresql',{
    identity:[{version:'18.0',current_database:'postgres',current_user:'admin'}],
    databases:[{name:'postgres',accessible:true,is_template:false}]
  });
  var plan=sql.planDatabaseBootstrap({database:'app',schemas:['app']},{targetDialect:'postgresql'});
  var report=await sql.assessDatabaseBootstrapPrerequisites(client,plan);
  assert.strictEqual(report.schemaVersion,1);
  assert.strictEqual(report.status,'attention');
  assert.strictEqual(report.discovery.dialect,'postgresql');
  assert.ok(report.checks.some(function(item){return item.id==='target-database'&&item.status==='ready';}));
  assert.ok(report.checks.some(function(item){return item.id==='administrative-privileges';}));
  assert.ok(report.checks.some(function(item){return item.id==='database-client-after-create';}));

  var mismatch=await sql.assessDatabaseBootstrapPrerequisites(fakeClient('mysql',{
    identity:[],databases:[]
  }),plan);
  assert.strictEqual(mismatch.status,'blocked');
  assert.strictEqual(mismatch.discovery,null);
}

async function clientSurface(){
  var state={
    identity:[{version:'3.49.0'}],
    databases:[{seq:0,name:'main',file:':memory:'}]
  };
  var adapter={
    descriptor:{capabilities:{},supports:function(){return false;}},
    createConnection:function(){
      return {
        connected:true,
        async query(statement){
          var rows;
          if(/sqlite_version/.test(statement))rows=state.identity;
          else if(/database_list/.test(statement))rows=state.databases;
          else rows=[];
          return {rows:rows,fields:[],rowCount:rows.length};
        },
        async close(){}
      };
    }
  };
  var client=new sql.Client(adapter,'sqlite',{pool:false});
  var report=await client.discoverServer();
  assert.strictEqual(report.identity.product,'SQLite');
}

Promise.resolve()
  .then(postgresqlDiscovery)
  .then(otherDialects)
  .then(prerequisiteAssessment)
  .then(clientSurface)
  .then(function(){console.log('NuBloxSQL database server discovery contract: PASS');})
  .catch(function(error){console.error(error);process.exitCode=1;});
