'use strict';

var SCHEMA_VERSION=1;
var APPLY_MODES=Object.freeze(['immediate','reload','restart','new-session','immutable','unknown']);
var SCOPES=Object.freeze(['server','database','session','connection','unknown']);

function freeze(value){
  if(!value||typeof value!=='object'||Object.isFrozen(value))return value;
  Object.keys(value).forEach(function(key){freeze(value[key]);});
  return Object.freeze(value);
}
function dialectOf(client){
  if(!client||typeof client!=='object'||typeof client.all!=='function'){
    throw new TypeError('NuBloxSQL configuration discovery requires a NuBloxSQL-like client');
  }
  var dialect=String(client.dialect||'').toLowerCase();
  if(dialect==='postgres'||dialect==='pg')dialect='postgresql';
  if(dialect==='mssql'||dialect==='sql-server')dialect='sqlserver';
  if(['postgresql','mysql','sqlite','sqlserver'].indexOf(dialect)===-1){
    throw new RangeError('NuBloxSQL configuration discovery does not support dialect "'+dialect+'"');
  }
  return dialect;
}
function str(value){return value===undefined||value===null?null:String(value);}
function num(value){return value===undefined||value===null||value===''?null:Number(value);}
function bool(value){
  if(value===undefined||value===null)return null;
  if(value===true||value===1||value==='1')return true;
  if(value===false||value===0||value==='0')return false;
  return Boolean(value);
}
function setting(name,value,scope,apply,mutable,restartRequired,source,description,native){
  return freeze({
    name:String(name),
    value:value===undefined?null:value,
    scope:scope,
    apply:apply,
    mutable:mutable,
    restartRequired:restartRequired,
    source:source||null,
    description:description||null,
    native:freeze(Object.assign({},native||{}))
  });
}

function pgApply(context,pendingRestart){
  if(pendingRestart===true)return 'restart';
  if(context==='internal')return 'immutable';
  if(context==='postmaster')return 'restart';
  if(context==='sighup')return 'reload';
  if(context==='backend'||context==='superuser-backend')return 'new-session';
  if(context==='user'||context==='superuser')return 'immediate';
  return 'unknown';
}
function pgScope(context){
  if(context==='user'||context==='superuser'||context==='backend'||context==='superuser-backend')return 'session';
  return 'server';
}
function normalizePostgres(rows){
  return rows.map(function(row){
    var context=str(row.context);
    var pending=bool(row.pending_restart);
    var apply=pgApply(context,pending);
    return setting(
      row.name,
      row.setting,
      pgScope(context),
      apply,
      apply!=='immutable',
      apply==='restart',
      str(row.source),
      str(row.short_desc),
      row
    );
  });
}

function normalizeMysql(rows){
  return rows.map(function(row){
    return setting(
      row.name!==undefined?row.name:row.Variable_name,
      row.value!==undefined?row.value:row.Value,
      'server',
      'unknown',
      null,
      null,
      null,
      null,
      row
    );
  });
}

function normalizeSqlServer(rows){
  return rows.map(function(row){
    var dynamic=bool(row.is_dynamic);
    var apply=dynamic===true?'immediate':dynamic===false?'restart':'unknown';
    return setting(
      row.name,
      row.value_in_use!==undefined?row.value_in_use:row.value,
      'server',
      apply,
      dynamic,
      dynamic===false?true:dynamic===true?false:null,
      'sys.configurations',
      str(row.description),
      row
    );
  });
}

var SQLITE_PRAGMAS=Object.freeze([
  'foreign_keys','journal_mode','synchronous','busy_timeout','cache_size',
  'temp_store','locking_mode','auto_vacuum','wal_autocheckpoint','mmap_size','page_size'
]);
function sqliteScope(name){
  return ['foreign_keys','busy_timeout','cache_size','temp_store','locking_mode','wal_autocheckpoint','mmap_size'].indexOf(name)>=0?'connection':'database';
}
function sqliteApply(name){
  if(name==='page_size'||name==='auto_vacuum')return 'unknown';
  return 'immediate';
}
async function discoverSqlite(client,operation){
  var settings=[];
  for(var i=0;i<SQLITE_PRAGMAS.length;i+=1){
    var name=SQLITE_PRAGMAS[i];
    var rows=await client.all('PRAGMA '+name,operation);
    var row=Array.isArray(rows)&&rows.length?rows[0]:{};
    var keys=Object.keys(row);
    var value=keys.length?row[keys[0]]:null;
    settings.push(setting(
      name,
      value,
      sqliteScope(name),
      sqliteApply(name),
      true,
      null,
      'PRAGMA',
      null,
      row
    ));
  }
  return settings;
}

async function discover(client,options){
  options=options||{};
  var dialect=dialectOf(client);
  var rows;
  var settings;
  if(dialect==='postgresql'){
    rows=await client.all(
      'SELECT name, setting, unit, category, short_desc, context, vartype, source, boot_val, reset_val, pending_restart FROM pg_settings ORDER BY name',
      options.operation||{}
    );
    settings=normalizePostgres(rows||[]);
  }else if(dialect==='mysql'){
    rows=await client.all('SHOW GLOBAL VARIABLES',options.operation||{});
    settings=normalizeMysql(rows||[]);
  }else if(dialect==='sqlserver'){
    rows=await client.all(
      'SELECT name, value, value_in_use, minimum, maximum, is_dynamic, is_advanced, description FROM sys.configurations ORDER BY name',
      options.operation||{}
    );
    settings=normalizeSqlServer(rows||[]);
  }else{
    settings=await discoverSqlite(client,options.operation||{});
  }

  var summary={settings:settings.length,mutable:0,immutable:0,restartRequired:0,unknownMutability:0};
  settings.forEach(function(item){
    if(item.mutable===true)summary.mutable+=1;
    else if(item.mutable===false)summary.immutable+=1;
    else summary.unknownMutability+=1;
    if(item.restartRequired===true)summary.restartRequired+=1;
  });

  return freeze({
    schemaVersion:SCHEMA_VERSION,
    dialect:dialect,
    settings:freeze(settings),
    summary:freeze(summary)
  });
}

function find(report,name){
  if(!report||report.schemaVersion!==SCHEMA_VERSION||!Array.isArray(report.settings)){
    throw new TypeError('NuBloxSQL configuration discovery report v'+SCHEMA_VERSION+' required');
  }
  if(typeof name!=='string'||!name.trim())throw new TypeError('NuBloxSQL configuration setting name must be a non-empty string');
  var target=name.trim().toLowerCase();
  for(var i=0;i<report.settings.length;i+=1){
    if(String(report.settings[i].name).toLowerCase()===target)return report.settings[i];
  }
  return null;
}

exports.SCHEMA_VERSION=SCHEMA_VERSION;
exports.APPLY_MODES=APPLY_MODES;
exports.SCOPES=SCOPES;
exports.discover=discover;
exports.find=find;
