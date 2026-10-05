'use strict';

var DATA = require('./DialectRegistryData');

var SCHEMA_VERSION = 1;
var MASTER_PROFILE_COUNT = 100;
var PRIMARY_DIALECTS = Object.freeze([
  'ansi','mysql','mariadb','postgresql','cockroachdb','yugabytedb','sqlserver',
  'oracle','db2','sqlite','duckdb','firebird','snowflake','bigquery','redshift',
  'teradata','spark','databricks','hive','trino','presto','clickhouse','hana',
  'informix','sybase-ase'
]);
var ALIASES = Object.freeze({ pg:'postgresql', postgres:'postgresql', mssql:'sqlserver', 'sql-server':'sqlserver' });
var SURFACE_KEYS = Object.freeze([
  'capabilities','dataTypes','operators','functions','ddl','dml','dcl','tcl','proceduralLanguage'
]);
var SURFACE_LEVELS = Object.freeze([
  'modelled','partial','inherited-unverified','unmodelled','not-applicable'
]);
var QUALIFIED_VERSIONS = Object.freeze({
  postgresql:Object.freeze(['15','16','17','18']),
  mysql:Object.freeze(['8.4','9.7']),
  sqlite:Object.freeze(['node:sqlite@node-22','node:sqlite@node-24','node:sqlite@node-26']),
  sqlserver:Object.freeze(['2019','2022','2025'])
});
var RUNTIME_ADAPTERS = Object.freeze({ postgresql:'postgresql', mysql:'mysql', sqlite:'sqlite', sqlserver:'sqlserver' });
var WIRE_PROTOCOLS = Object.freeze({
  postgresql:Object.freeze({status:'qualified',family:'postgresql'}),
  mysql:Object.freeze({status:'qualified',family:'mysql-classic'}),
  sqlite:Object.freeze({status:'qualified',family:'embedded'}),
  sqlserver:Object.freeze({status:'qualified',family:'tds'}),
  questdb:Object.freeze({status:'declared',family:'postgresql'})
});

function deepFreeze(value){
  if(!value||typeof value!=='object'||Object.isFrozen(value))return value;
  Object.keys(value).forEach(function(key){deepFreeze(value[key]);});
  return Object.freeze(value);
}
function normalizeId(value){
  if(typeof value!=='string'||!value.trim())throw new TypeError('Dialect registry id must be a non-empty string');
  var id=value.trim().toLowerCase();
  return ALIASES[id]||id;
}
function rowObject(row){
  return {
    ordinal:row[0],id:row[1],vendor:row[2],product:row[3],dialectName:row[4],
    parentDialect:row[5],kind:row[6],firstClass:row[7]===true
  };
}

var SOURCE_PROFILES=DATA.map(rowObject);
var SYNTHETIC_DIALECTS=[{
  ordinal:null,id:'db2',vendor:'IBM',product:'IBM Db2 family',dialectName:'IBM Db2 SQL',
  parentDialect:null,kind:'primary-dialect',firstClass:true
}];
var RAW_DIALECTS=SOURCE_PROFILES.concat(SYNTHETIC_DIALECTS);
var RAW_BY_ID=Object.create(null);
RAW_DIALECTS.forEach(function(entry){RAW_BY_ID[entry.id]=entry;});

function ancestryIds(id){
  var normalized=normalizeId(id),out=[],seen=Object.create(null),current=RAW_BY_ID[normalized];
  while(current){
    if(seen[current.id])throw new Error('Dialect registry parent cycle at '+current.id);
    seen[current.id]=true;
    out.push(current.id);
    current=current.parentDialect?RAW_BY_ID[current.parentDialect]:null;
  }
  return out;
}
function primaryDialectId(id){
  var chain=ancestryIds(id);
  for(var i=0;i<chain.length;i+=1)if(PRIMARY_DIALECTS.indexOf(chain[i])!==-1)return chain[i];
  return null;
}
function grammarRootId(id){
  var chain=ancestryIds(id);
  return chain.length?chain[chain.length-1]:null;
}
function surfaceLevel(id){
  if(id==='postgresql'||id==='mysql'||id==='sqlite')return 'modelled';
  if(id==='sqlserver')return 'partial';
  var primary=primaryDialectId(id);
  if(primary==='postgresql'||primary==='mysql'||primary==='sqlite'||primary==='sqlserver')return 'inherited-unverified';
  return 'unmodelled';
}
function surfaces(id){
  var level=surfaceLevel(id),out={};
  SURFACE_KEYS.forEach(function(key){out[key]=level;});
  if(id==='oracle-plsql')out.proceduralLanguage='modelled';
  return deepFreeze(out);
}
function implementation(id){
  var adapter=RUNTIME_ADAPTERS[id]||null;
  var primary=primaryDialectId(id);
  var candidateAdapter=!adapter&&primary&&RUNTIME_ADAPTERS[primary]?RUNTIME_ADAPTERS[primary]:null;
  return deepFreeze({
    routable:!!adapter,
    driver:adapter?'implemented':'unimplemented',
    adapter:adapter,
    candidateAdapter:candidateAdapter,
    capabilityModel:id==='postgresql'||id==='mysql'||id==='sqlite'
      ?'tier1-exhaustive-v1'
      :id==='sqlserver'?'runtime-descriptor-partial'
      :candidateAdapter?'inherited-unverified':'unmodelled',
    compiler:id==='postgresql'||id==='mysql'||id==='sqlite'
      ?'implemented'
      :id==='sqlserver'?'unsupported'
      :candidateAdapter?'inherited-unverified':'unmodelled'
  });
}
function versionInfo(id){
  var qualified=QUALIFIED_VERSIONS[id]||Object.freeze([]);
  return deepFreeze({qualified:qualified,policy:qualified.length?'qualified-runtime-matrix':'unqualified'});
}
function wireProtocol(id){
  var direct=WIRE_PROTOCOLS[id];
  if(direct)return direct;
  var primary=primaryDialectId(id);
  if(primary&&WIRE_PROTOCOLS[primary])return deepFreeze({status:'compatibility-unverified',family:WIRE_PROTOCOLS[primary].family});
  return deepFreeze({status:'unknown',family:null});
}
function dialectRecord(entry){
  var id=entry.id;
  return deepFreeze({
    id:id,name:entry.dialectName,kind:entry.kind,firstClass:entry.firstClass===true,
    parentDialect:entry.parentDialect||null,primaryDialect:primaryDialectId(id),grammarRoot:grammarRootId(id),
    implementation:implementation(id),surfaces:surfaces(id),
    source:{registryOrdinal:entry.ordinal,platformExamples:entry.product}
  });
}
function productRecord(entry){
  var id=entry.id;
  return deepFreeze({
    id:id,vendor:entry.vendor,product:entry.product,dialect:id,parentDialect:entry.parentDialect||null,
    primaryDialect:primaryDialectId(id),versions:versionInfo(id),driver:implementation(id),wireProtocol:wireProtocol(id),
    compatibility:{
      grammar:entry.parentDialect?'inherits-or-specializes':'native-or-independent',
      parentDialect:entry.parentDialect||null,grammarRoot:grammarRootId(id)
    },
    language:surfaces(id),
    proceduralLanguage:id==='oracle-plsql'?'PL/SQL':null,
    source:{registryOrdinal:entry.ordinal,dialectFamily:entry.dialectName,platformExamples:entry.product}
  });
}

var DIALECTS=deepFreeze(RAW_DIALECTS.map(dialectRecord));
var PRODUCTS=deepFreeze(SOURCE_PROFILES.map(productRecord));
var DIALECT_BY_ID=Object.create(null);
DIALECTS.forEach(function(entry){DIALECT_BY_ID[entry.id]=entry;});
var PRODUCT_BY_ID=Object.create(null);
PRODUCTS.forEach(function(entry){PRODUCT_BY_ID[entry.id]=entry;});

function dialect(id){return DIALECT_BY_ID[normalizeId(id)]||null;}
function product(id){return PRODUCT_BY_ID[normalizeId(id)]||null;}
function resolve(id){
  var normalized=normalizeId(id),p=PRODUCT_BY_ID[normalized]||null,d=DIALECT_BY_ID[normalized]||null;
  return !p&&!d?null:deepFreeze({id:normalized,product:p,dialect:d});
}
function ancestry(id){
  return deepFreeze(ancestryIds(id).map(function(entryId){return DIALECT_BY_ID[entryId];}));
}
function descendants(id){
  var normalized=normalizeId(id);
  if(!DIALECT_BY_ID[normalized])return deepFreeze([]);
  return deepFreeze(DIALECTS.filter(function(entry){
    return entry.id!==normalized&&ancestryIds(entry.id).indexOf(normalized)!==-1;
  }));
}
function productsForDialect(id,options){
  options=options||{};
  var normalized=normalizeId(id);
  if(!DIALECT_BY_ID[normalized])return deepFreeze([]);
  var includeDescendants=options.includeDescendants===true;
  return deepFreeze(PRODUCTS.filter(function(entry){
    if(entry.dialect===normalized)return true;
    return includeDescendants&&ancestryIds(entry.dialect).indexOf(normalized)!==-1;
  }));
}
function report(){
  return deepFreeze({
    schemaVersion:SCHEMA_VERSION,
    counts:{
      masterProfiles:PRODUCTS.length,
      dialectDefinitions:DIALECTS.length,
      firstClassDialects:PRIMARY_DIALECTS.length,
      routableProducts:PRODUCTS.filter(function(entry){return entry.driver.routable;}).length
    },
    primaryDialects:PRIMARY_DIALECTS,dialects:DIALECTS,products:PRODUCTS
  });
}
function validate(){
  var errors=[],dialectIds=Object.create(null),productIds=Object.create(null);
  DIALECTS.forEach(function(entry){
    if(dialectIds[entry.id])errors.push('duplicate dialect id: '+entry.id);
    dialectIds[entry.id]=true;
    if(entry.parentDialect&&!DIALECT_BY_ID[entry.parentDialect])errors.push('missing parent dialect for '+entry.id+': '+entry.parentDialect);
    SURFACE_KEYS.forEach(function(key){
      if(SURFACE_LEVELS.indexOf(entry.surfaces[key])===-1)errors.push('invalid surface level for '+entry.id+': '+key);
    });
  });
  PRODUCTS.forEach(function(entry){
    if(productIds[entry.id])errors.push('duplicate product id: '+entry.id);
    productIds[entry.id]=true;
    if(!DIALECT_BY_ID[entry.dialect])errors.push('missing dialect for product '+entry.id);
  });
  PRIMARY_DIALECTS.forEach(function(id){
    var entry=DIALECT_BY_ID[id];
    if(!entry)errors.push('missing primary dialect: '+id);
    else if(!entry.firstClass)errors.push('primary dialect is not marked first-class: '+id);
  });
  if(PRODUCTS.length!==MASTER_PROFILE_COUNT)errors.push('master profile count must remain '+MASTER_PROFILE_COUNT);
  if(PRIMARY_DIALECTS.length!==25)errors.push('primary dialect target count must remain 25');
  return deepFreeze({
    valid:errors.length===0,schemaVersion:SCHEMA_VERSION,masterProfiles:PRODUCTS.length,
    dialectDefinitions:DIALECTS.length,firstClassDialects:PRIMARY_DIALECTS.length,errors:errors
  });
}

exports.SCHEMA_VERSION=SCHEMA_VERSION;
exports.MASTER_PROFILE_COUNT=MASTER_PROFILE_COUNT;
exports.PRIMARY_DIALECTS=PRIMARY_DIALECTS;
exports.SURFACE_KEYS=SURFACE_KEYS;
exports.SURFACE_LEVELS=SURFACE_LEVELS;
exports.aliases=ALIASES;
exports.dialects=DIALECTS;
exports.products=PRODUCTS;
exports.dialect=dialect;
exports.product=product;
exports.resolve=resolve;
exports.ancestry=ancestry;
exports.descendants=descendants;
exports.productsForDialect=productsForDialect;
exports.report=report;
exports.validate=validate;
