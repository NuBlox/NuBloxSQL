'use strict';

var crypto=require('crypto');

var SCHEMA_VERSION=1;
var ENGINES=Object.freeze(['postgresql','mysql','sqlite','sqlserver']);
var EXECUTION=Object.freeze(['provider','external','manual','satisfied','blocked']);
var PROVIDER_ACTIONS=Object.freeze([
  'inspect-target','install','verify-install','initialize','verify-initialize',
  'upgrade','verify-upgrade','uninstall','verify-uninstall'
]);

var PROFILES=freeze({
  postgresql:{
    engine:'postgresql',
    runtimeKind:'server',
    initializationModel:'cluster',
    installationStrategies:['package','binary','source','container','manual'],
    initializationAction:'initialize-cluster'
  },
  mysql:{
    engine:'mysql',
    runtimeKind:'server',
    initializationModel:'data-directory',
    installationStrategies:['package','binary','source','container','manual'],
    initializationAction:'initialize-data-directory'
  },
  sqlserver:{
    engine:'sqlserver',
    runtimeKind:'server',
    initializationModel:'instance',
    installationStrategies:['setup','package','container','manual'],
    initializationAction:'initialize-instance'
  },
  sqlite:{
    engine:'sqlite',
    runtimeKind:'embedded',
    initializationModel:'database-file',
    installationStrategies:['embedded','cli','package','source','manual'],
    initializationAction:'initialize-database-file'
  }
});

function freeze(value){
  if(!value||typeof value!=='object'||Object.isFrozen(value))return value;
  Object.keys(value).forEach(function(key){freeze(value[key]);});
  return Object.freeze(value);
}
function normalizeEngine(value){
  if(typeof value!=='string'||!value.trim())throw new TypeError('NuBloxSQL engine is required');
  value=value.trim().toLowerCase();
  if(value==='postgres'||value==='pg')value='postgresql';
  if(value==='mssql'||value==='sql-server')value='sqlserver';
  if(ENGINES.indexOf(value)===-1)throw new RangeError('NuBloxSQL engine must be one of: '+ENGINES.join(', '));
  return value;
}
function text(value,label,required){
  if(value===undefined||value===null||value===''){
    if(required)throw new TypeError('NuBloxSQL '+label+' is required');
    return null;
  }
  if(typeof value!=='string'||!value.trim())throw new TypeError('NuBloxSQL '+label+' must be a non-empty string');
  return value.trim();
}
function stringArray(value,label){
  if(value===undefined||value===null)return freeze([]);
  if(!Array.isArray(value))throw new TypeError('NuBloxSQL '+label+' must be an array');
  var seen=Object.create(null);
  return freeze(value.map(function(item){
    item=text(item,label+' item',true);
    var key=item.toLowerCase();
    if(seen[key])throw new Error('NuBloxSQL '+label+' contains duplicate "'+item+'"');
    seen[key]=true;
    return item;
  }));
}
function hash(value){
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
function profile(engine){
  return PROFILES[normalizeEngine(engine)];
}
function select(specification){
  specification=specification||{};
  if(!specification||typeof specification!=='object'||Array.isArray(specification))throw new TypeError('NuBloxSQL engine selection must be an object');
  var engine=normalizeEngine(specification.engine||specification.dialect);
  var p=profile(engine);
  var strategy=text(specification.installationStrategy,'installation strategy',false)||p.installationStrategies[0];
  if(p.installationStrategies.indexOf(strategy)===-1){
    throw new RangeError('NuBloxSQL '+engine+' installation strategy must be one of: '+p.installationStrategies.join(', '));
  }
  var core={
    schemaVersion:SCHEMA_VERSION,
    engine:engine,
    dialect:engine,
    targetVersion:text(specification.targetVersion,'target version',true),
    edition:text(specification.edition,'edition',false),
    distribution:text(specification.distribution,'distribution',false),
    installationStrategy:strategy,
    components:stringArray(specification.components,'components'),
    runtimeKind:p.runtimeKind,
    initializationModel:p.initializationModel
  };
  return freeze(Object.assign({selectionHash:hash(core)},core));
}
function validateSelection(value){
  if(!value||value.schemaVersion!==SCHEMA_VERSION||!value.selectionHash)throw new TypeError('NuBloxSQL engine selection v'+SCHEMA_VERSION+' required');
  normalizeEngine(value.engine);
  return value;
}

exports.SCHEMA_VERSION=SCHEMA_VERSION;
exports.ENGINES=ENGINES;
exports.EXECUTION=EXECUTION;
exports.PROVIDER_ACTIONS=PROVIDER_ACTIONS;
exports.PROFILES=PROFILES;
exports.normalizeEngine=normalizeEngine;
exports.profile=profile;
exports.select=select;
exports.validateSelection=validateSelection;
