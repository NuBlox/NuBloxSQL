'use strict';

var crypto=require('crypto');
var configuration=require('./DatabaseConfiguration');

var SCHEMA_VERSION=1;
var EXECUTION=Object.freeze(['automatic','manual','satisfied']);
var ACTIONS=Object.freeze(['set','reload','restart']);

function freeze(value){
  if(!value||typeof value!=='object'||Object.isFrozen(value))return value;
  Object.keys(value).forEach(function(key){freeze(value[key]);});
  return Object.freeze(value);
}
function normalizeDialect(value){
  value=String(value||'').trim().toLowerCase();
  if(value==='postgres'||value==='pg')value='postgresql';
  if(value==='mssql'||value==='sql-server')value='sqlserver';
  if(['postgresql','mysql','sqlite','sqlserver'].indexOf(value)===-1){
    throw new RangeError('NuBloxSQL configuration planning does not support dialect "'+value+'"');
  }
  return value;
}
function name(value){
  if(typeof value!=='string'||!value.trim())throw new TypeError('NuBloxSQL configuration change name must be a non-empty string');
  value=value.trim();
  if(value.indexOf('\0')!==-1)throw new TypeError('NuBloxSQL configuration change name cannot contain NUL bytes');
  return value;
}
function tokenName(value,label){
  value=name(value);
  if(!/^[A-Za-z_][A-Za-z0-9_.]*$/.test(value))throw new TypeError('NuBloxSQL '+label+' contains unsupported characters');
  return value;
}
function literal(value,prefixUnicode){
  if(value===null)return 'NULL';
  if(typeof value==='number'){
    if(!Number.isFinite(value))throw new TypeError('NuBloxSQL configuration value number must be finite');
    return String(value);
  }
  if(typeof value==='boolean')return value?'1':'0';
  var quoted="'"+String(value).replace(/'/g,"''")+"'";
  return prefixUnicode?'N'+quoted:quoted;
}
function asChanges(specification){
  if(!specification||typeof specification!=='object'||Array.isArray(specification))throw new TypeError('NuBloxSQL configuration change specification must be an object');
  if(!Array.isArray(specification.changes)||!specification.changes.length)throw new TypeError('NuBloxSQL configuration change specification requires a non-empty changes array');
  var seen=Object.create(null);
  return freeze(specification.changes.map(function(change,index){
    if(!change||typeof change!=='object'||Array.isArray(change))throw new TypeError('NuBloxSQL configuration change '+index+' must be an object');
    var n=name(change.name);
    var key=n.toLowerCase();
    if(seen[key])throw new Error('NuBloxSQL configuration change contains duplicate setting "'+n+'"');
    seen[key]=true;
    if(!Object.prototype.hasOwnProperty.call(change,'value'))throw new TypeError('NuBloxSQL configuration change "'+n+'" requires a value');
    if(change.value===null||change.value===undefined||!['string','number','boolean'].includes(typeof change.value)){
      throw new TypeError('NuBloxSQL configuration change "'+n+'" value must be a string, number or boolean');
    }
    return freeze({name:n,value:change.value});
  }));
}
function sameValue(left,right){
  if(left===right)return true;
  if(left===null||left===undefined||right===null||right===undefined)return false;
  return String(left)===String(right);
}
function step(id,action,setting,execution,sql,requirements,notes,to){
  return freeze({
    id:id,
    kind:'configuration',
    action:action,
    name:setting?setting.name:null,
    from:setting?setting.value:null,
    to:to===undefined?null:to,
    scope:setting?setting.scope:'server',
    execution:execution,
    sql:sql||null,
    verification:setting&&setting.name?freeze({mode:'setting-equals',name:setting.name,value:to===undefined?setting.value:to}):null,
    requirements:freeze(Object.assign({
      adminPrivileges:false,
      transactionForbidden:false,
      reloadRequired:false,
      restartRequired:false,
      reconnectRequired:false
    },requirements||{})),
    notes:notes||null
  });
}
function satisfied(id,setting,to){
  return step(id,'set',setting,'satisfied',null,{},'Setting already has the requested value.',to);
}
function manual(id,action,setting,to,notes,requirements){
  return step(id,action,setting,'manual',null,requirements,notes,to);
}
function automatic(id,action,setting,to,sql,requirements,notes){
  return step(id,action,setting,'automatic',sql,requirements,notes,to);
}

function postgresSteps(discovery,setting,to,index){
  if(setting.mutable===false||setting.apply==='immutable'){
    throw new RangeError('NuBloxSQL configuration setting "'+setting.name+'" is immutable in PostgreSQL');
  }
  var base='config-'+String(index+1).padStart(4,'0');
  if(sameValue(setting.value,to))return [satisfied(base,setting,to)];
  var allow=configuration.find(discovery,'allow_alter_system');
  if(allow&&String(allow.value).toLowerCase()!=='on'&&String(allow.value)!=='1'&&allow.value!==true){
    return [manual(
      base,'set',setting,to,
      'PostgreSQL allow_alter_system is disabled. Use the externally managed configuration mechanism instead of ALTER SYSTEM.',
      {adminPrivileges:true}
    )];
  }
  var set=automatic(
    base,'set',setting,to,
    'ALTER SYSTEM SET '+tokenName(setting.name,'PostgreSQL configuration setting name')+' = '+literal(to,false),
    {adminPrivileges:true,transactionForbidden:true,reloadRequired:setting.apply!=='restart',restartRequired:setting.apply==='restart'},
    'PostgreSQL ALTER SYSTEM writes the cluster-wide setting to postgresql.auto.conf.'
  );
  if(setting.apply==='restart'){
    return [set,manual(
      base+':restart','restart',setting,to,
      'Restart PostgreSQL to activate this postmaster-context setting. NuBloxSQL does not restart the database service automatically.',
      {adminPrivileges:true,restartRequired:true,reconnectRequired:true}
    )];
  }
  return [set,automatic(
    base+':reload','reload',setting,to,
    'SELECT pg_reload_conf()',
    {adminPrivileges:true,reloadRequired:true,reconnectRequired:setting.apply==='new-session'},
    setting.apply==='new-session'
      ?'Reload configuration. New sessions will observe the changed default; existing sessions may retain their prior value.'
      :'Reload PostgreSQL configuration after ALTER SYSTEM.'
  )];
}

function mysqlSteps(setting,to,index){
  var base='config-'+String(index+1).padStart(4,'0');
  if(sameValue(setting.value,to))return [satisfied(base,setting,to)];
  return [manual(
    base,'set',setting,to,
    'MySQL discovery does not yet prove whether this variable is dynamic and persistible. Review the variable-specific semantics before choosing SET GLOBAL, SET PERSIST or SET PERSIST_ONLY.',
    {adminPrivileges:true}
  )];
}

function sqlserverSteps(discovery,setting,to,index){
  var base='config-'+String(index+1).padStart(4,'0');
  if(sameValue(setting.value,to))return [satisfied(base,setting,to)];
  if(typeof to!=='number'||!Number.isInteger(to))throw new TypeError('NuBloxSQL SQL Server configuration value for "'+setting.name+'" must be an integer');
  var minimum=setting.native&&setting.native.minimum!==undefined?Number(setting.native.minimum):null;
  var maximum=setting.native&&setting.native.maximum!==undefined?Number(setting.native.maximum):null;
  if(minimum!==null&&Number.isFinite(minimum)&&to<minimum)throw new RangeError('NuBloxSQL SQL Server configuration value for "'+setting.name+'" is below minimum '+minimum);
  if(maximum!==null&&Number.isFinite(maximum)&&to>maximum)throw new RangeError('NuBloxSQL SQL Server configuration value for "'+setting.name+'" exceeds maximum '+maximum);
  var advanced=setting.native&&(setting.native.is_advanced===true||setting.native.is_advanced===1||setting.native.is_advanced==='1');
  if(advanced&&String(setting.name).toLowerCase()!=='show advanced options'){
    var showAdvanced=configuration.find(discovery,'show advanced options');
    var enabled=showAdvanced&&(showAdvanced.value===true||showAdvanced.value===1||showAdvanced.value==='1');
    if(!enabled){
      return [manual(
        base,'set',setting,to,
        'This is a SQL Server advanced configuration option and show advanced options is not currently enabled. Enable it explicitly, apply the reviewed change, then restore the prior visibility setting.',
        {adminPrivileges:true,restartRequired:setting.apply==='restart'}
      )];
    }
  }
  var sql='EXEC sys.sp_configure '+literal(setting.name,true)+', '+String(to)+'; RECONFIGURE';
  var dynamic=setting.native&&setting.native.is_dynamic;
  dynamic=dynamic===true||dynamic===1||dynamic==='1';
  var set=automatic(
    base,'set',setting,to,sql,
    {adminPrivileges:true,restartRequired:!dynamic},
    'SQL Server configuration changes use sys.sp_configure followed by RECONFIGURE.'
  );
  if(dynamic)return [set];
  return [set,manual(
    base+':restart','restart',setting,to,
    'Restart the SQL Server Database Engine to activate this non-dynamic configuration option.',
    {adminPrivileges:true,restartRequired:true,reconnectRequired:true}
  )];
}

function sqliteSteps(setting,to,index){
  var base='config-'+String(index+1).padStart(4,'0');
  if(sameValue(setting.value,to))return [satisfied(base,setting,to)];
  if(setting.apply==='unknown'){
    return [manual(
      base,'set',setting,to,
      'This SQLite PRAGMA has lifecycle constraints that are not safe to reduce to a direct assignment plan. Apply it with the required database/VACUUM lifecycle explicitly.',
      {transactionForbidden:true}
    )];
  }
  return [automatic(
    base,'set',setting,to,
    'PRAGMA '+tokenName(setting.name,'SQLite PRAGMA name')+' = '+literal(to,false),
    {
      transactionForbidden:setting.name==='foreign_keys'||setting.name==='journal_mode',
      reconnectRequired:false
    },
    'SQLite configuration changes are connection/database PRAGMA operations; native PRAGMA semantics remain authoritative.'
  )];
}

function hashPlan(value){
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
function plan(discovery,specification,options){
  options=options||{};
  if(!discovery||discovery.schemaVersion!==configuration.SCHEMA_VERSION||!Array.isArray(discovery.settings)){
    throw new TypeError('NuBloxSQL configuration discovery report v'+configuration.SCHEMA_VERSION+' required');
  }
  var dialect=normalizeDialect(options.targetDialect||discovery.dialect);
  if(normalizeDialect(discovery.dialect)!==dialect)throw new RangeError('NuBloxSQL configuration discovery dialect does not match planning target');
  var changes=asChanges(specification);
  var steps=[];

  changes.forEach(function(change,index){
    var setting=configuration.find(discovery,change.name);
    if(!setting)throw new RangeError('NuBloxSQL configuration setting "'+change.name+'" was not found in the discovery report');
    var rendered;
    if(dialect==='postgresql')rendered=postgresSteps(discovery,setting,change.value,index);
    else if(dialect==='mysql')rendered=mysqlSteps(setting,change.value,index);
    else if(dialect==='sqlserver')rendered=sqlserverSteps(discovery,setting,change.value,index);
    else rendered=sqliteSteps(setting,change.value,index);
    Array.prototype.push.apply(steps,rendered);
  });

  var automaticCount=steps.filter(function(x){return x.execution==='automatic';}).length;
  var manualCount=steps.filter(function(x){return x.execution==='manual';}).length;
  var satisfiedCount=steps.filter(function(x){return x.execution==='satisfied';}).length;
  var core={
    schemaVersion:SCHEMA_VERSION,
    discoverySchemaVersion:configuration.SCHEMA_VERSION,
    targetDialect:dialect,
    executable:manualCount===0,
    requires:freeze({
      adminPrivileges:steps.some(function(x){return x.requirements.adminPrivileges===true;}),
      reload:steps.some(function(x){return x.requirements.reloadRequired===true;}),
      restart:steps.some(function(x){return x.requirements.restartRequired===true;}),
      reconnect:steps.some(function(x){return x.requirements.reconnectRequired===true;}),
      transactionBoundary:steps.some(function(x){return x.requirements.transactionForbidden===true;})
    }),
    summary:freeze({steps:steps.length,automatic:automaticCount,manual:manualCount,satisfied:satisfiedCount}),
    steps:freeze(steps)
  };
  return freeze(Object.assign({planHash:hashPlan(core)},core));
}
function validate(planValue){
  if(!planValue||planValue.schemaVersion!==SCHEMA_VERSION||!Array.isArray(planValue.steps)){
    throw new TypeError('NuBloxSQL configuration change plan v'+SCHEMA_VERSION+' required');
  }
  normalizeDialect(planValue.targetDialect);
  return planValue;
}
function automaticSteps(planValue){
  validate(planValue);
  return freeze(planValue.steps.filter(function(x){return x.execution==='automatic';}));
}
function manualSteps(planValue){
  validate(planValue);
  return freeze(planValue.steps.filter(function(x){return x.execution==='manual';}));
}

exports.SCHEMA_VERSION=SCHEMA_VERSION;
exports.EXECUTION=EXECUTION;
exports.ACTIONS=ACTIONS;
exports.plan=plan;
exports.validate=validate;
exports.automaticSteps=automaticSteps;
exports.manualSteps=manualSteps;
