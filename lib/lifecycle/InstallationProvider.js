'use strict';

var crypto=require('crypto');
var lifecycle=require('./EngineLifecycle');

var SCHEMA_VERSION=1;

function freeze(value){
  if(!value||typeof value!=='object'||Object.isFrozen(value))return value;
  Object.keys(value).forEach(function(key){freeze(value[key]);});
  return Object.freeze(value);
}
function stable(value){
  if(Array.isArray(value))return value.map(stable);
  if(value&&typeof value==='object'){
    var result={};
    Object.keys(value).sort().forEach(function(key){result[key]=stable(value[key]);});
    return result;
  }
  return value;
}
function text(value,label){
  if(typeof value!=='string'||!value.trim())throw new TypeError('NuBloxSQL installation provider '+label+' must be a non-empty string');
  return value.trim();
}
function installedItem(item,index){
  if(!item||typeof item!=='object'||Array.isArray(item))throw new TypeError('NuBloxSQL installation provider installed['+index+'] must be an object');
  return freeze({
    engine:lifecycle.normalizeEngine(item.engine||item.dialect),
    version:text(item.version,'installed version'),
    state:item.state===undefined||item.state===null?'ready':String(item.state).trim().toLowerCase(),
    edition:item.edition===undefined||item.edition===null?null:String(item.edition),
    distribution:item.distribution===undefined||item.distribution===null?null:String(item.distribution),
    components:freeze((Array.isArray(item.components)?item.components.map(String):[]).sort()),
    native:freeze(Object.assign({},item.native||{}))
  });
}
function resourceItem(item,index){
  if(!item||typeof item!=='object'||Array.isArray(item))throw new TypeError('NuBloxSQL installation provider resources['+index+'] must be an object');
  return freeze({
    engine:lifecycle.normalizeEngine(item.engine||item.dialect),
    key:text(item.key,'resource key'),
    state:item.state===undefined||item.state===null?'ready':String(item.state).trim().toLowerCase(),
    native:freeze(Object.assign({},item.native||{}))
  });
}
function descriptor(provider){
  validate(provider);
  var actions=Array.isArray(provider.actions)?provider.actions.slice():[];
  actions=actions.map(function(action){
    action=text(action,'action');
    if(lifecycle.PROVIDER_ACTIONS.indexOf(action)===-1)throw new RangeError('NuBloxSQL installation provider action "'+action+'" is unsupported');
    return action;
  });
  return freeze({
    schemaVersion:SCHEMA_VERSION,
    id:text(provider.id,'id'),
    kind:text(provider.kind||'custom','kind'),
    actions:freeze(Array.from(new Set(actions)).sort()),
    metadata:freeze(Object.assign({},provider.metadata||{}))
  });
}
function validate(provider){
  if(!provider||typeof provider!=='object'||Array.isArray(provider))throw new TypeError('NuBloxSQL installation provider must be an object');
  text(provider.id,'id');
  if(typeof provider.inspectTarget!=='function')throw new TypeError('NuBloxSQL installation provider requires inspectTarget(request)');
  return provider;
}
function supports(provider,action){
  validate(provider);
  return Array.isArray(provider.actions)&&provider.actions.indexOf(action)!==-1;
}
async function inspect(provider,request){
  validate(provider);
  request=request||{};
  var raw=await provider.inspectTarget(freeze(Object.assign({},request)));
  if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new TypeError('NuBloxSQL installation provider inspectTarget() must return an object');
  var platform=raw.platform||{};
  var core={
    schemaVersion:SCHEMA_VERSION,
    provider:descriptor(provider),
    targetId:raw.targetId===undefined?null:String(raw.targetId),
    platform:freeze({
      os:platform.os===undefined?null:String(platform.os),
      family:platform.family===undefined?null:String(platform.family),
      version:platform.version===undefined?null:String(platform.version),
      architecture:platform.architecture===undefined?null:String(platform.architecture)
    }),
    elevated:raw.elevated===true?true:raw.elevated===false?false:null,
    installed:freeze((Array.isArray(raw.installed)?raw.installed.map(installedItem):[]).sort(function(left,right){
      return [left.engine,left.version,left.state,left.edition||'',left.distribution||''].join('\u0000')
        .localeCompare([right.engine,right.version,right.state,right.edition||'',right.distribution||''].join('\u0000'));
    })),
    resources:freeze((Array.isArray(raw.resources)?raw.resources.map(resourceItem):[]).sort(function(left,right){
      return [left.engine,left.key,left.state].join('\u0000')
        .localeCompare([right.engine,right.key,right.state].join('\u0000'));
    })),
    facts:freeze(Object.assign({},raw.facts||{}))
  };
  var inspectionHash=crypto.createHash('sha256').update(JSON.stringify(stable(core))).digest('hex');
  return freeze(Object.assign({inspectionHash:inspectionHash},core));
}
function validateTarget(value){
  if(!value||value.schemaVersion!==SCHEMA_VERSION||!value.inspectionHash||!value.provider||!Array.isArray(value.provider.actions)||!value.platform||!Array.isArray(value.installed)||!Array.isArray(value.resources))throw new TypeError('NuBloxSQL engine target inspection v'+SCHEMA_VERSION+' required');
  return value;
}

exports.SCHEMA_VERSION=SCHEMA_VERSION;
exports.validate=validate;
exports.descriptor=descriptor;
exports.supports=supports;
exports.inspect=inspect;
exports.validateTarget=validateTarget;
