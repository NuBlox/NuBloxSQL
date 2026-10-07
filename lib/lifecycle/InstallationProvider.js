'use strict';

var lifecycle=require('./EngineLifecycle');

var SCHEMA_VERSION=1;

function freeze(value){
  if(!value||typeof value!=='object'||Object.isFrozen(value))return value;
  Object.keys(value).forEach(function(key){freeze(value[key]);});
  return Object.freeze(value);
}
function text(value,label){
  if(typeof value!=='string'||!value.trim())throw new TypeError('NuBloxSQL installation provider '+label+' must be a non-empty string');
  return value.trim();
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
    actions:freeze(Array.from(new Set(actions))),
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
  var result={
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
    installed:freeze(Array.isArray(raw.installed)?raw.installed.map(function(item){return freeze(Object.assign({},item));}):[]),
    facts:freeze(Object.assign({},raw.facts||{}))
  };
  return freeze(result);
}
function validateTarget(value){
  if(!value||value.schemaVersion!==SCHEMA_VERSION||!value.provider||!value.platform)throw new TypeError('NuBloxSQL engine target inspection v'+SCHEMA_VERSION+' required');
  return value;
}

exports.SCHEMA_VERSION=SCHEMA_VERSION;
exports.validate=validate;
exports.descriptor=descriptor;
exports.supports=supports;
exports.inspect=inspect;
exports.validateTarget=validateTarget;
