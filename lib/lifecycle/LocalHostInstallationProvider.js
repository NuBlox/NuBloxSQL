'use strict';

var childProcess=require('node:child_process');
var fs=require('node:fs');
var os=require('node:os');
var path=require('node:path');
var lifecycle=require('./EngineLifecycle');

var SCHEMA_VERSION=1;
var PROVIDER_ID='local-host';
var ACTIONS=Object.freeze(['inspect-target']);

var PACKAGE_PROBES=Object.freeze({
  darwin:Object.freeze([
    Object.freeze({name:'brew',executable:'brew',args:['--version']}),
    Object.freeze({name:'port',executable:'port',args:['version']})
  ]),
  linux:Object.freeze([
    Object.freeze({name:'apt-get',executable:'apt-get',args:['--version']}),
    Object.freeze({name:'dnf',executable:'dnf',args:['--version']}),
    Object.freeze({name:'yum',executable:'yum',args:['--version']}),
    Object.freeze({name:'zypper',executable:'zypper',args:['--version']}),
    Object.freeze({name:'apk',executable:'apk',args:['--version']})
  ]),
  win32:Object.freeze([
    Object.freeze({name:'winget',executable:'winget',args:['--version']}),
    Object.freeze({name:'choco',executable:'choco',args:['--version']}),
    Object.freeze({name:'scoop',executable:'scoop',args:['--version']})
  ])
});

var CONTAINER_PROBES=Object.freeze([
  Object.freeze({name:'docker',executable:'docker',args:['--version']}),
  Object.freeze({name:'podman',executable:'podman',args:['--version']})
]);

function freeze(value){
  if(!value||typeof value!=='object'||Object.isFrozen(value))return value;
  Object.keys(value).forEach(function(key){freeze(value[key]);});
  return Object.freeze(value);
}
function text(value,label,required){
  if(value===undefined||value===null||value===''){
    if(required)throw new TypeError('NuBloxSQL local-host '+label+' is required');
    return null;
  }
  if(typeof value!=='string'||!value.trim())throw new TypeError('NuBloxSQL local-host '+label+' must be a non-empty string');
  return value.trim();
}
function secretLike(key){
  return /password|passwd|pwd|secret|token|credential|private[_-]?key|encryption[_-]?key/i.test(String(key));
}
function assertNoSecrets(value,label){
  if(value===null||value===undefined)return;
  if(Array.isArray(value)){
    value.forEach(function(item,index){assertNoSecrets(item,label+'['+index+']');});
    return;
  }
  if(typeof value!=='object')return;
  if(typeof ArrayBuffer!=='undefined'&&ArrayBuffer.isView&&ArrayBuffer.isView(value))return;
  Object.keys(value).forEach(function(key){
    if(secretLike(key))throw new Error('NuBloxSQL local-host '+label+' must not contain secret-like field "'+key+'"');
    assertNoSecrets(value[key],label+'.'+key);
  });
}
function bounded(value){
  if(value===undefined||value===null)return '';
  value=String(value).replace(/\u0000/g,'');
  return value.length>4096?value.slice(0,4096):value;
}
function line(value){
  value=bounded(value).trim();
  if(!value)return '';
  return value.split(/\r?\n/)[0].trim();
}
function createCommandRunner(options){
  if(typeof options.commandRunner==='function')return options.commandRunner;
  var timeout=options.commandTimeoutMs===undefined?2500:Number(options.commandTimeoutMs);
  if(!Number.isFinite(timeout)||timeout<=0)throw new TypeError('NuBloxSQL local-host commandTimeoutMs must be a positive number');

  return function commandRunner(executable,args){
    var result=childProcess.spawnSync(executable,args,{
      encoding:'utf8',
      timeout:timeout,
      windowsHide:true,
      shell:false,
      maxBuffer:1024*1024,
      stdio:['ignore','pipe','pipe']
    });
    var error=result.error||null;
    var unavailable=!!(error&&error.code==='ENOENT');
    return {
      available:!unavailable,
      status:typeof result.status==='number'?result.status:null,
      signal:result.signal||null,
      stdout:bounded(result.stdout),
      stderr:bounded(result.stderr),
      error:error?{code:error.code||null,message:error.message||String(error)}:null
    };
  };
}
function run(runner,executable,args){
  var raw;
  try{raw=runner(executable,args.slice());}
  catch(error){
    return freeze({
      executable:executable,
      args:freeze(args.slice()),
      available:false,
      status:null,
      stdout:'',
      stderr:'',
      error:freeze({code:error.code||null,message:error.message||String(error)})
    });
  }
  raw=raw||{};
  return freeze({
    executable:executable,
    args:freeze(args.slice()),
    available:raw.available!==false,
    status:typeof raw.status==='number'?raw.status:null,
    stdout:bounded(raw.stdout),
    stderr:bounded(raw.stderr),
    error:raw.error?freeze({
      code:raw.error.code===undefined?null:String(raw.error.code),
      message:raw.error.message===undefined?String(raw.error):String(raw.error.message)
    }):null
  });
}
function succeeded(probe){
  return !!probe&&probe.available===true&&probe.status===0;
}
function toolEvidence(probe,name){
  if(!probe||!probe.available)return null;
  return freeze({
    name:name,
    available:true,
    version:line(probe.stdout)||line(probe.stderr)||null,
    status:probe.status
  });
}
function parsePostgresVersion(output){
  var match=String(output||'').match(/PostgreSQL\)?\s+([0-9]+(?:\.[0-9]+){0,2})/i);
  if(!match)return null;
  var parts=match[1].split('.');
  return freeze({version:parts[0],buildVersion:match[1]});
}
function parseMySqlVersion(output){
  var match=String(output||'').match(/\bVer\s+([0-9]+(?:\.[0-9]+){1,2})/i)
    ||String(output||'').match(/mysqld[^0-9]*([0-9]+(?:\.[0-9]+){1,2})/i);
  if(!match)return null;
  var parts=match[1].split('.');
  return freeze({version:parts.slice(0,2).join('.'),buildVersion:match[1]});
}
function parseSqliteVersion(output){
  var match=String(output||'').trim().match(/^([0-9]+(?:\.[0-9]+){1,3})/);
  if(!match)return null;
  return freeze({version:match[1],buildVersion:match[1]});
}
function sqlServerProductVersion(build){
  var major=Number(String(build||'').split('.')[0]);
  if(major===17)return '2025';
  if(major===16)return '2022';
  if(major===15)return '2019';
  if(major===14)return '2017';
  if(major===13)return '2016';
  return build||null;
}
function parseSqlServerVersion(output){
  var match=String(output||'').match(/\b(?:Version\s*)?([0-9]{2}\.[0-9]+(?:\.[0-9]+){1,2})\b/i);
  if(!match)return null;
  return freeze({version:sqlServerProductVersion(match[1]),buildVersion:match[1]});
}
function installedEntry(engine,parsed,source,components,native){
  if(!parsed||!parsed.version)return null;
  return freeze({
    engine:engine,
    version:parsed.version,
    state:'ready',
    edition:null,
    distribution:source,
    components:freeze((components||[]).slice().sort()),
    native:freeze(Object.assign({source:source,buildVersion:parsed.buildVersion||parsed.version},native||{}))
  });
}
function pathProbe(runner,executable,args,parser,engine,source,components){
  var probe=run(runner,executable,args);
  if(!succeeded(probe))return freeze({probe:probe,installed:null});
  return freeze({
    probe:probe,
    installed:installedEntry(engine,parser(probe.stdout||probe.stderr),source,components,{executable:executable})
  });
}
function detectPostgres(runner,platform){
  var direct=pathProbe(runner,'postgres',['--version'],parsePostgresVersion,'postgresql','path',['server']);
  if(direct.installed)return freeze({installed:direct.installed,probes:freeze([direct.probe])});

  var configVersion=run(runner,'pg_config',['--version']);
  var configBindir=run(runner,'pg_config',['--bindir']);
  var probes=[direct.probe,configVersion,configBindir];
  if(succeeded(configBindir)){
    var bindir=line(configBindir.stdout);
    if(bindir&&path.isAbsolute(bindir)){
      var candidate=path.join(bindir,platform==='win32'?'postgres.exe':'postgres');
      var fromBindir=pathProbe(runner,candidate,['--version'],parsePostgresVersion,'postgresql','pg_config-bindir',['server']);
      probes.push(fromBindir.probe);
      if(fromBindir.installed)return freeze({installed:fromBindir.installed,probes:freeze(probes)});
    }
  }
  return freeze({installed:null,probes:freeze(probes)});
}
function detectMySql(runner,platform){
  var candidates=['mysqld'];
  if(platform==='linux')candidates.push('/usr/sbin/mysqld');
  if(platform==='darwin')candidates.push('/usr/local/mysql/bin/mysqld');
  if(platform==='win32')candidates.push('mysqld.exe');

  var probes=[];
  for(var i=0;i<candidates.length;i+=1){
    var found=pathProbe(runner,candidates[i],['--version'],parseMySqlVersion,'mysql','path',['server']);
    probes.push(found.probe);
    if(found.installed)return freeze({installed:found.installed,probes:freeze(probes)});
  }
  return freeze({installed:null,probes:freeze(probes)});
}
function detectSqlite(runner){
  var found=pathProbe(runner,'sqlite3',['-version'],parseSqliteVersion,'sqlite','sqlite-cli',['cli']);
  return freeze({installed:found.installed,probes:freeze([found.probe])});
}
function detectSqlServer(runner,platform){
  var candidates=platform==='linux'
    ?['sqlservr','/opt/mssql/bin/sqlservr']
    :(platform==='win32'?['sqlservr.exe','sqlservr']:['sqlservr']);
  var probes=[];
  for(var i=0;i<candidates.length;i+=1){
    var found=pathProbe(runner,candidates[i],['-v'],parseSqlServerVersion,'sqlserver','sqlservr',['server']);
    probes.push(found.probe);
    if(found.installed)return freeze({installed:found.installed,probes:freeze(probes)});
  }
  return freeze({installed:null,probes:freeze(probes)});
}
function fileSystem(options){
  return options.filesystem||fs;
}
function exists(fsys,filename){
  try{return !!fsys.existsSync(filename);}catch(ignore){return false;}
}
function stat(fsys,filename){
  try{return fsys.statSync(filename);}catch(ignore){return null;}
}
function read(fsys,filename,encoding){
  try{return fsys.readFileSync(filename,encoding);}catch(ignore){return null;}
}
function resourceHint(value,index){
  if(!value||typeof value!=='object'||Array.isArray(value))throw new TypeError('NuBloxSQL local-host resourceHints['+index+'] must be an object');
  assertNoSecrets(value,'resourceHints['+index+']');
  var engine=lifecycle.normalizeEngine(value.engine||value.dialect);
  var kind=text(value.kind,'resource hint kind',true);
  if(engine==='postgresql'&&kind!=='cluster')throw new RangeError('NuBloxSQL local-host PostgreSQL resource hint kind must be cluster');
  if(engine==='mysql'&&kind!=='data-directory')throw new RangeError('NuBloxSQL local-host MySQL resource hint kind must be data-directory');
  if(engine==='sqlite'&&kind!=='database-file')throw new RangeError('NuBloxSQL local-host SQLite resource hint kind must be database-file');
  if(engine==='sqlserver'&&kind!=='instance')throw new RangeError('NuBloxSQL local-host SQL Server resource hint kind must be instance');
  return freeze({
    engine:engine,
    kind:kind,
    path:value.path===undefined?null:text(value.path,'resource hint path',true),
    name:value.name===undefined?null:text(value.name,'resource hint name',true),
    service:value.service===undefined?null:text(value.service,'resource hint service',true)
  });
}
function inspectPostgresResource(fsys,hint){
  if(!hint.path||!exists(fsys,hint.path))return null;
  var info=stat(fsys,hint.path);
  if(!info||typeof info.isDirectory!=='function'||!info.isDirectory())return null;
  var version=read(fsys,path.join(hint.path,'PG_VERSION'),'utf8');
  if(version===null)return freeze({
    engine:'postgresql',key:'cluster:'+hint.path,state:'incomplete',
    native:freeze({path:path.resolve(hint.path),reason:'PG_VERSION-missing'})
  });
  return freeze({
    engine:'postgresql',key:'cluster:'+hint.path,state:'ready',
    native:freeze({path:path.resolve(hint.path),clusterVersion:String(version).trim()})
  });
}
function inspectMySqlResource(fsys,hint){
  if(!hint.path||!exists(fsys,hint.path))return null;
  var info=stat(fsys,hint.path);
  if(!info||typeof info.isDirectory!=='function'||!info.isDirectory())return null;
  var systemSchema=path.join(hint.path,'mysql');
  return freeze({
    engine:'mysql',
    key:'data-directory:'+hint.path,
    state:exists(fsys,systemSchema)?'ready':'incomplete',
    native:freeze({path:path.resolve(hint.path),systemSchemaPresent:exists(fsys,systemSchema)})
  });
}
function inspectSqliteResource(fsys,hint){
  if(!hint.path||!exists(fsys,hint.path))return null;
  var info=stat(fsys,hint.path);
  if(!info||typeof info.isFile!=='function'||!info.isFile())return null;
  var header=read(fsys,hint.path,null);
  var ok=!!(header&&header.length>=16&&header.subarray(0,16).toString('utf8')==='SQLite format 3\u0000');
  return freeze({
    engine:'sqlite',
    key:'database-file:'+hint.path,
    state:ok?'ready':'incomplete',
    native:freeze({path:path.resolve(hint.path),sqliteHeader:ok})
  });
}
function safeServiceName(value){
  return typeof value==='string'&&/^[A-Za-z0-9_.@-]+$/.test(value);
}
function inspectSqlServerResource(runner,platform,hint){
  var name=hint.name||'MSSQLSERVER';
  var service=hint.service||(platform==='win32'?(name==='MSSQLSERVER'?'MSSQLSERVER':'MSSQL
function inspectResources(options,runner,platform){
  var fsys=fileSystem(options);
  var hints=(options.resourceHints||[]).map(resourceHint);
  var resources=[];
  hints.forEach(function(hint){
    var result=null;
    if(hint.engine==='postgresql')result=inspectPostgresResource(fsys,hint);
    else if(hint.engine==='mysql')result=inspectMySqlResource(fsys,hint);
    else if(hint.engine==='sqlite')result=inspectSqliteResource(fsys,hint);
    else if(hint.engine==='sqlserver')result=inspectSqlServerResource(runner,platform,hint);
    if(result)resources.push(result);
  });
  return freeze(resources);
}
function installedHint(value,index){
  if(!value||typeof value!=='object'||Array.isArray(value))throw new TypeError('NuBloxSQL local-host installedHints['+index+'] must be an object');
  assertNoSecrets(value,'installedHints['+index+']');
  return freeze({
    engine:lifecycle.normalizeEngine(value.engine||value.dialect),
    version:text(value.version,'installed hint version',true),
    state:value.state===undefined?'ready':String(value.state).trim().toLowerCase(),
    edition:value.edition===undefined||value.edition===null?null:String(value.edition),
    distribution:value.distribution===undefined||value.distribution===null?'hint':String(value.distribution),
    components:freeze((Array.isArray(value.components)?value.components.map(String):[]).sort()),
    native:freeze(Object.assign({source:'hint'},value.native||{}))
  });
}
function mergeInstalled(detected,hints){
  var result=[];
  var seen=Object.create(null);
  detected.concat(hints).forEach(function(item){
    if(!item)return;
    var key=[item.engine,item.version,item.state,item.edition||'',item.distribution||'',(item.components||[]).join(',')].join('\u0000');
    if(seen[key])return;
    seen[key]=true;
    result.push(item);
  });
  return freeze(result);
}
function inspectTools(runner,platform){
  var packageManagers=[];
  (PACKAGE_PROBES[platform]||[]).forEach(function(def){
    var evidence=toolEvidence(run(runner,def.executable,def.args),def.name);
    if(evidence)packageManagers.push(evidence);
  });
  var containers=[];
  CONTAINER_PROBES.forEach(function(def){
    var evidence=toolEvidence(run(runner,def.executable,def.args),def.name);
    if(evidence)containers.push(evidence);
  });
  return freeze({packageManagers:freeze(packageManagers),containerRuntimes:freeze(containers)});
}
function systemInfo(options){
  var custom=options.system||{};
  var platform=custom.platform||os.platform();
  var architecture=custom.architecture||custom.arch||os.arch();
  var release=custom.release||os.release();
  var hostname=custom.hostname||os.hostname();
  var elevated;
  if(custom.elevated===true||custom.elevated===false)elevated=custom.elevated;
  else if(typeof process.getuid==='function')elevated=process.getuid()===0;
  else elevated=null;
  return freeze({
    platform:String(platform),
    architecture:String(architecture),
    release:String(release),
    hostname:String(hostname),
    elevated:elevated
  });
}
function create(options){
  options=options||{};
  if(!options||typeof options!=='object'||Array.isArray(options))throw new TypeError('NuBloxSQL local-host provider options must be an object');
  if(options.resourceHints!==undefined&&!Array.isArray(options.resourceHints))throw new TypeError('NuBloxSQL local-host resourceHints must be an array');
  if(options.installedHints!==undefined&&!Array.isArray(options.installedHints))throw new TypeError('NuBloxSQL local-host installedHints must be an array');
  var info=systemInfo(options);
  var runner=createCommandRunner(options);
  var id=text(options.id,'provider id',false)||PROVIDER_ID;
  var hints=(options.installedHints||[]).map(installedHint);

  return {
    id:id,
    kind:'local-host',
    actions:ACTIONS,
    metadata:freeze({
      schemaVersion:SCHEMA_VERSION,
      readOnly:true,
      hostMutation:false,
      targetScope:'local-process-host'
    }),

    async inspectTarget(){
      var postgres=detectPostgres(runner,info.platform);
      var mysql=detectMySql(runner,info.platform);
      var sqlite=detectSqlite(runner);
      var sqlserver=detectSqlServer(runner,info.platform);
      var detected=[postgres.installed,mysql.installed,sqlite.installed,sqlserver.installed].filter(Boolean);
      var tools=inspectTools(runner,info.platform);
      var resources=inspectResources(options,runner,info.platform);

      return {
        targetId:'local-host:'+info.hostname,
        platform:{
          os:info.platform,
          family:info.platform==='darwin'?'macos':info.platform==='win32'?'windows':info.platform==='linux'?'linux':info.platform,
          version:info.release,
          architecture:info.architecture
        },
        elevated:info.elevated,
        installed:mergeInstalled(detected,hints),
        resources:resources,
        facts:{
          providerSchemaVersion:SCHEMA_VERSION,
          readOnly:true,
          hostMutation:false,
          packageManagers:tools.packageManagers,
          containerRuntimes:tools.containerRuntimes,
          prerequisites:{
            platformRecognized:['darwin','linux','win32'].indexOf(info.platform)!==-1,
            architecture:info.architecture,
            packageManagerAvailable:tools.packageManagers.length>0,
            containerRuntimeAvailable:tools.containerRuntimes.length>0,
            elevationKnown:info.elevated!==null,
            mutationActionsSupported:false
          },
          engineProbes:{
            postgresql:postgres.probes.map(function(probe){return freeze({executable:probe.executable,available:probe.available,status:probe.status});}),
            mysql:mysql.probes.map(function(probe){return freeze({executable:probe.executable,available:probe.available,status:probe.status});}),
            sqlite:sqlite.probes.map(function(probe){return freeze({executable:probe.executable,available:probe.available,status:probe.status});}),
            sqlserver:sqlserver.probes.map(function(probe){return freeze({executable:probe.executable,available:probe.available,status:probe.status});})
          },
          resourceHintsChecked:(options.resourceHints||[]).length
        }
      };
    }
  };
}

exports.SCHEMA_VERSION=SCHEMA_VERSION;
exports.PROVIDER_ID=PROVIDER_ID;
exports.ACTIONS=ACTIONS;
exports.create=create;
+name):'mssql-server');
  if(!safeServiceName(service))throw new RangeError('NuBloxSQL local-host SQL Server service hint contains unsupported characters');

  if(platform==='win32'){
    var windowsProbe=run(runner,'sc.exe',['query',service]);
    if(!windowsProbe.available||windowsProbe.status!==0)return null;
    var windowsOutput=windowsProbe.stdout+'\n'+windowsProbe.stderr;
    return freeze({
      engine:'sqlserver',
      key:'instance:'+name,
      state:/STATE\s*:\s*\d+\s+RUNNING/i.test(windowsOutput)?'ready':'stopped',
      native:freeze({service:service,status:windowsProbe.status})
    });
  }

  var loadProbe=run(runner,'systemctl',['show','--property=LoadState','--value',service]);
  if(!loadProbe.available||loadProbe.status!==0||line(loadProbe.stdout)!=='loaded')return null;
  var activeProbe=run(runner,'systemctl',['is-active',service]);
  if(!activeProbe.available)return null;
  return freeze({
    engine:'sqlserver',
    key:'instance:'+name,
    state:activeProbe.status===0&&/^active\s*$/mi.test(activeProbe.stdout)?'ready':'stopped',
    native:freeze({service:service,status:activeProbe.status})
  });
}
function inspectResources(options,runner,platform){
  var fsys=fileSystem(options);
  var hints=(options.resourceHints||[]).map(resourceHint);
  var resources=[];
  hints.forEach(function(hint){
    var result=null;
    if(hint.engine==='postgresql')result=inspectPostgresResource(fsys,hint);
    else if(hint.engine==='mysql')result=inspectMySqlResource(fsys,hint);
    else if(hint.engine==='sqlite')result=inspectSqliteResource(fsys,hint);
    else if(hint.engine==='sqlserver')result=inspectSqlServerResource(runner,platform,hint);
    if(result)resources.push(result);
  });
  return freeze(resources);
}
function installedHint(value,index){
  if(!value||typeof value!=='object'||Array.isArray(value))throw new TypeError('NuBloxSQL local-host installedHints['+index+'] must be an object');
  assertNoSecrets(value,'installedHints['+index+']');
  return freeze({
    engine:lifecycle.normalizeEngine(value.engine||value.dialect),
    version:text(value.version,'installed hint version',true),
    state:value.state===undefined?'ready':String(value.state).trim().toLowerCase(),
    edition:value.edition===undefined||value.edition===null?null:String(value.edition),
    distribution:value.distribution===undefined||value.distribution===null?'hint':String(value.distribution),
    components:freeze((Array.isArray(value.components)?value.components.map(String):[]).sort()),
    native:freeze(Object.assign({source:'hint'},value.native||{}))
  });
}
function mergeInstalled(detected,hints){
  var result=[];
  var seen=Object.create(null);
  detected.concat(hints).forEach(function(item){
    if(!item)return;
    var key=[item.engine,item.version,item.state,item.edition||'',item.distribution||'',(item.components||[]).join(',')].join('\u0000');
    if(seen[key])return;
    seen[key]=true;
    result.push(item);
  });
  return freeze(result);
}
function inspectTools(runner,platform){
  var packageManagers=[];
  (PACKAGE_PROBES[platform]||[]).forEach(function(def){
    var evidence=toolEvidence(run(runner,def.executable,def.args),def.name);
    if(evidence)packageManagers.push(evidence);
  });
  var containers=[];
  CONTAINER_PROBES.forEach(function(def){
    var evidence=toolEvidence(run(runner,def.executable,def.args),def.name);
    if(evidence)containers.push(evidence);
  });
  return freeze({packageManagers:freeze(packageManagers),containerRuntimes:freeze(containers)});
}
function systemInfo(options){
  var custom=options.system||{};
  var platform=custom.platform||os.platform();
  var architecture=custom.architecture||custom.arch||os.arch();
  var release=custom.release||os.release();
  var hostname=custom.hostname||os.hostname();
  var elevated;
  if(custom.elevated===true||custom.elevated===false)elevated=custom.elevated;
  else if(typeof process.getuid==='function')elevated=process.getuid()===0;
  else elevated=null;
  return freeze({
    platform:String(platform),
    architecture:String(architecture),
    release:String(release),
    hostname:String(hostname),
    elevated:elevated
  });
}
function create(options){
  options=options||{};
  if(!options||typeof options!=='object'||Array.isArray(options))throw new TypeError('NuBloxSQL local-host provider options must be an object');
  if(options.resourceHints!==undefined&&!Array.isArray(options.resourceHints))throw new TypeError('NuBloxSQL local-host resourceHints must be an array');
  if(options.installedHints!==undefined&&!Array.isArray(options.installedHints))throw new TypeError('NuBloxSQL local-host installedHints must be an array');
  var info=systemInfo(options);
  var runner=createCommandRunner(options);
  var id=text(options.id,'provider id',false)||PROVIDER_ID;
  var hints=(options.installedHints||[]).map(installedHint);

  return {
    id:id,
    kind:'local-host',
    actions:ACTIONS,
    metadata:freeze({
      schemaVersion:SCHEMA_VERSION,
      readOnly:true,
      hostMutation:false,
      targetScope:'local-process-host'
    }),

    async inspectTarget(){
      var postgres=detectPostgres(runner,info.platform);
      var mysql=detectMySql(runner,info.platform);
      var sqlite=detectSqlite(runner);
      var sqlserver=detectSqlServer(runner,info.platform);
      var detected=[postgres.installed,mysql.installed,sqlite.installed,sqlserver.installed].filter(Boolean);
      var tools=inspectTools(runner,info.platform);
      var resources=inspectResources(options,runner,info.platform);

      return {
        targetId:'local-host:'+info.hostname,
        platform:{
          os:info.platform,
          family:info.platform==='darwin'?'macos':info.platform==='win32'?'windows':info.platform==='linux'?'linux':info.platform,
          version:info.release,
          architecture:info.architecture
        },
        elevated:info.elevated,
        installed:mergeInstalled(detected,hints),
        resources:resources,
        facts:{
          providerSchemaVersion:SCHEMA_VERSION,
          readOnly:true,
          hostMutation:false,
          packageManagers:tools.packageManagers,
          containerRuntimes:tools.containerRuntimes,
          prerequisites:{
            platformRecognized:['darwin','linux','win32'].indexOf(info.platform)!==-1,
            architecture:info.architecture,
            packageManagerAvailable:tools.packageManagers.length>0,
            containerRuntimeAvailable:tools.containerRuntimes.length>0,
            elevationKnown:info.elevated!==null,
            mutationActionsSupported:false
          },
          engineProbes:{
            postgresql:postgres.probes.map(function(probe){return freeze({executable:probe.executable,available:probe.available,status:probe.status});}),
            mysql:mysql.probes.map(function(probe){return freeze({executable:probe.executable,available:probe.available,status:probe.status});}),
            sqlite:sqlite.probes.map(function(probe){return freeze({executable:probe.executable,available:probe.available,status:probe.status});}),
            sqlserver:sqlserver.probes.map(function(probe){return freeze({executable:probe.executable,available:probe.available,status:probe.status});})
          },
          resourceHintsChecked:(options.resourceHints||[]).length
        }
      };
    }
  };
}

exports.SCHEMA_VERSION=SCHEMA_VERSION;
exports.PROVIDER_ID=PROVIDER_ID;
exports.ACTIONS=ACTIONS;
exports.create=create;
