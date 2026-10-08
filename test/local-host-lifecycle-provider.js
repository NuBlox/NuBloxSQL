'use strict';

var assert=require('assert');
var sql=require('..');

function commandRunner(executable,args){
  var key=executable+' '+args.join(' ');
  var responses={
    'postgres --version':{available:true,status:0,stdout:'postgres (PostgreSQL) 18.1\n'},
    'mysqld --version':{available:true,status:0,stdout:'mysqld  Ver 8.4.11 for Linux on x86_64 (MySQL Community Server - GPL)\n'},
    'sqlite3 -version':{available:true,status:0,stdout:'3.53.0 2026-09-01 00:00:00 abcdef\n'},
    'sqlservr -v':{available:true,status:0,stdout:'17.0.4085.5\n'},
    'apt-get --version':{available:true,status:0,stdout:'apt 3.0.3 (amd64)\n'},
    'docker --version':{available:true,status:0,stdout:'Docker version 28.5.1, build test\n'},
    'systemctl show --property=LoadState --value mssql-server':{available:true,status:0,stdout:'loaded\n'},
    'systemctl is-active mssql-server':{available:true,status:0,stdout:'active\n'}
  };
  return responses[key]||{available:false,status:null,stdout:'',stderr:'',error:{code:'ENOENT',message:'not found'}};
}

var dirs=new Set(['/pg','/mysql','/mysql/mysql']);
var files=new Set(['/app.db']);
var filesystem={
  existsSync:function(filename){return dirs.has(filename)||files.has(filename)||filename==='/pg/PG_VERSION';},
  statSync:function(filename){
    if(dirs.has(filename))return {isDirectory:function(){return true;},isFile:function(){return false;}};
    if(files.has(filename))return {isDirectory:function(){return false;},isFile:function(){return true;}};
    throw new Error('ENOENT');
  },
  readFileSync:function(filename,encoding){
    if(filename==='/pg/PG_VERSION')return encoding?'18\n':Buffer.from('18\n');
    if(filename==='/app.db'){
      var header=Buffer.from('SQLite format 3\u0000');
      return Buffer.concat([header,Buffer.alloc(64)]);
    }
    throw new Error('ENOENT');
  }
};

function create(){
  return sql.createLocalHostInstallationProvider({
    system:{
      platform:'linux',
      architecture:'x64',
      release:'6.8.0-test',
      hostname:'db-host',
      elevated:false
    },
    commandRunner:commandRunner,
    filesystem:filesystem,
    resourceHints:[
      {engine:'postgresql',kind:'cluster',path:'/pg'},
      {engine:'mysql',kind:'data-directory',path:'/mysql'},
      {engine:'sqlite',kind:'database-file',path:'/app.db'},
      {engine:'sqlserver',kind:'instance',name:'MSSQLSERVER'}
    ]
  });
}

async function providerContract(){
  var provider=create();
  assert.strictEqual(provider.id,'local-host');
  assert.strictEqual(provider.kind,'local-host');
  assert.deepStrictEqual(Array.from(provider.actions),['inspect-target']);
  assert.strictEqual(provider.metadata.readOnly,true);
  assert.strictEqual(provider.metadata.hostMutation,false);
  assert.strictEqual(provider.executeAction,undefined);

  var descriptor=sql.installationProviderDescriptor(provider);
  assert.deepStrictEqual(Array.from(descriptor.actions),['inspect-target']);
}

async function targetInspection(){
  var provider=create();
  var target=await sql.inspectEngineTarget(provider);

  assert.strictEqual(target.targetId,'local-host:db-host');
  assert.strictEqual(target.platform.os,'linux');
  assert.strictEqual(target.platform.family,'linux');
  assert.strictEqual(target.platform.version,'6.8.0-test');
  assert.strictEqual(target.platform.architecture,'x64');
  assert.strictEqual(target.elevated,false);

  var byEngine=Object.fromEntries(target.installed.map(function(item){return [item.engine,item];}));
  assert.strictEqual(byEngine.postgresql.version,'18');
  assert.strictEqual(byEngine.postgresql.native.buildVersion,'18.1');
  assert.deepStrictEqual(Array.from(byEngine.postgresql.components),['server']);

  assert.strictEqual(byEngine.mysql.version,'8.4');
  assert.strictEqual(byEngine.mysql.native.buildVersion,'8.4.11');

  assert.strictEqual(byEngine.sqlite.version,'3.53.0');
  assert.deepStrictEqual(Array.from(byEngine.sqlite.components),['cli']);

  assert.strictEqual(byEngine.sqlserver.version,'2025');
  assert.strictEqual(byEngine.sqlserver.native.buildVersion,'17.0.4085.5');

  var resources=Object.fromEntries(target.resources.map(function(item){return [item.key,item];}));
  assert.strictEqual(resources['cluster:/pg'].state,'ready');
  assert.strictEqual(resources['data-directory:/mysql'].state,'ready');
  assert.strictEqual(resources['database-file:/app.db'].state,'ready');
  assert.strictEqual(resources['instance:MSSQLSERVER'].state,'ready');

  assert.strictEqual(target.facts.readOnly,true);
  assert.strictEqual(target.facts.hostMutation,false);
  assert.strictEqual(target.facts.prerequisites.platformRecognized,true);
  assert.strictEqual(target.facts.prerequisites.packageManagerAvailable,true);
  assert.strictEqual(target.facts.prerequisites.containerRuntimeAvailable,true);
  assert.strictEqual(target.facts.prerequisites.mutationActionsSupported,false);
  assert.strictEqual(target.facts.packageManagers[0].name,'apt-get');
  assert.strictEqual(target.facts.containerRuntimes[0].name,'docker');
  assert.strictEqual(target.facts.resourceHintsChecked,4);

  var second=await sql.inspectEngineTarget(provider);
  assert.strictEqual(second.inspectionHash,target.inspectionHash);
}

async function planningIntegration(){
  var provider=create();
  var target=await sql.inspectEngineTarget(provider);

  var pg=sql.selectDatabaseEngine({engine:'postgresql',targetVersion:'18'});
  var install=sql.planEngineInstallation(pg,target);
  assert.strictEqual(install.summary.satisfied,2);
  assert.strictEqual(install.executable,true);

  var init=sql.planEngineInitialization(pg,target,{dataDirectory:'/pg'});
  assert.strictEqual(init.summary.satisfied,2);
  assert.strictEqual(init.executable,true);

  var future=sql.selectDatabaseEngine({engine:'postgresql',targetVersion:'19'});
  var upgrade=sql.planEngineInstallation(future,target);
  assert.strictEqual(upgrade.summary.blocked,1);
  assert.strictEqual(upgrade.steps[0].action,'upgrade-required');
}

async function inspectionOnlyBoundary(){
  var provider=sql.createLocalHostInstallationProvider({
    system:{platform:'linux',architecture:'arm64',release:'test',hostname:'empty-host',elevated:false},
    commandRunner:function(){return {available:false,status:null,stdout:'',stderr:'',error:{code:'ENOENT',message:'not found'}};},
    filesystem:filesystem
  });
  var target=await sql.inspectEngineTarget(provider);
  assert.strictEqual(target.installed.length,0);

  var selection=sql.selectDatabaseEngine({engine:'postgresql',targetVersion:'18'});
  var plan=sql.planEngineInstallation(selection,target);
  assert.strictEqual(plan.summary.external,1);
  assert.strictEqual(plan.summary.provider,1);
  assert.strictEqual(plan.executable,false);

  var execution=await sql.executeEngineInstallation(provider,plan,{approvedPlanHash:plan.planHash});
  assert.strictEqual(execution.status,'blocked');
  assert.match(execution.reason,/externalHandler/);
}


async function prerequisiteAssessment(){
  var provider=create();
  var target=await sql.inspectEngineTarget(provider);
  var pg=sql.selectDatabaseEngine({engine:'postgresql',targetVersion:'18',installationStrategy:'package'});
  var pgAssessment=sql.assessEngineInstallationPrerequisites(pg,target);
  assert.strictEqual(pgAssessment.status,'attention');
  assert.strictEqual(pgAssessment.assessmentHash.length,64);
  assert.strictEqual(pgAssessment.selectionHash,pg.selectionHash);
  assert.strictEqual(pgAssessment.targetInspectionHash,target.inspectionHash);
  assert.ok(pgAssessment.checks.some(function(item){return item.id==='existing-runtime'&&item.status==='ready';}));
  assert.ok(pgAssessment.checks.some(function(item){return item.id==='installation-strategy'&&item.status==='ready';}));
  assert.ok(pgAssessment.checks.some(function(item){return item.id==='vendor-support-certification'&&item.status==='attention';}));

  var sqlserver=sql.selectDatabaseEngine({engine:'sqlserver',targetVersion:'2025',installationStrategy:'setup'});
  var blocked=sql.assessEngineInstallationPrerequisites(sqlserver,target);
  assert.strictEqual(blocked.status,'blocked');
  assert.ok(blocked.checks.some(function(item){
    return item.id==='installation-strategy'&&item.status==='blocked';
  }));

  var future=sql.selectDatabaseEngine({engine:'postgresql',targetVersion:'19',installationStrategy:'package'});
  var upgrade=sql.assessEngineInstallationPrerequisites(future,target);
  assert.strictEqual(upgrade.status,'blocked');
  assert.ok(upgrade.checks.some(function(item){
    return item.id==='existing-runtime'&&item.status==='blocked';
  }));

  var second=sql.assessEngineInstallationPrerequisites(pg,target);
  assert.strictEqual(second.assessmentHash,pgAssessment.assessmentHash);
}

async function hintsAndValidation(){
  var provider=sql.createLocalHostInstallationProvider({
    system:{platform:'darwin',architecture:'arm64',release:'25.0',hostname:'mac',elevated:false},
    commandRunner:function(){return {available:false,status:null,stdout:'',stderr:'',error:{code:'ENOENT',message:'not found'}};},
    filesystem:filesystem,
    installedHints:[
      {engine:'sqlite',version:'3.53.0',distribution:'embedded',components:['library'],native:{sourceFile:'app-runtime'}}
    ]
  });
  var target=await sql.inspectEngineTarget(provider);
  assert.strictEqual(target.installed.length,1);
  assert.strictEqual(target.installed[0].distribution,'embedded');
  assert.deepStrictEqual(Array.from(target.installed[0].components),['library']);

  assert.throws(function(){
    sql.createLocalHostInstallationProvider({resourceHints:{}});
  },/resourceHints must be an array/);

  assert.throws(function(){
    sql.createLocalHostInstallationProvider({
      installedHints:[{engine:'postgresql',version:'18',native:{password:'bad'}}]
    });
  },/must not contain secret-like field/);

  var badService=sql.createLocalHostInstallationProvider({
    system:{platform:'linux',architecture:'x64',release:'test',hostname:'bad',elevated:false},
    commandRunner:commandRunner,
    filesystem:filesystem,
    resourceHints:[{engine:'sqlserver',kind:'instance',name:'MSSQLSERVER',service:'mssql-server;rm'}]
  });
  await assert.rejects(function(){return sql.inspectEngineTarget(badService);},/service hint contains unsupported characters/);
}

Promise.resolve()
  .then(providerContract)
  .then(targetInspection)
  .then(planningIntegration)
  .then(inspectionOnlyBoundary)
  .then(prerequisiteAssessment)
  .then(hintsAndValidation)
  .then(function(){console.log('NuBloxSQL local-host lifecycle provider contract: PASS');})
  .catch(function(error){console.error(error);process.exitCode=1;});
