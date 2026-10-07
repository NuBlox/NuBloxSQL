'use strict';

var crypto=require('crypto');
var lifecycle=require('./EngineLifecycle');
var providers=require('./InstallationProvider');

var SCHEMA_VERSION=1;
var ACTIONS=Object.freeze([
  'initialize-cluster','initialize-data-directory','initialize-instance',
  'initialize-database-file','verify-initialize'
]);

function freeze(value){
  if(!value||typeof value!=='object'||Object.isFrozen(value))return value;
  Object.keys(value).forEach(function(key){freeze(value[key]);});
  return Object.freeze(value);
}
function hash(value){return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');}
function text(value,label){
  if(typeof value!=='string'||!value.trim())throw new TypeError('NuBloxSQL '+label+' is required');
  return value.trim();
}
function installed(target,selection){
  return (target.installed||[]).some(function(item){
    if(!item)return false;
    var engine;
    try{engine=lifecycle.normalizeEngine(item.engine||item.dialect);}catch(ignore){return false;}
    return engine===selection.engine&&String(item.version||'')===String(selection.targetVersion);
  });
}
function resourceKey(selection,specification){
  if(selection.engine==='postgresql')return 'cluster:'+text(specification.dataDirectory,'PostgreSQL dataDirectory');
  if(selection.engine==='mysql')return 'data-directory:'+text(specification.dataDirectory,'MySQL dataDirectory');
  if(selection.engine==='sqlserver')return 'instance:'+text(specification.instanceName,'SQL Server instanceName');
  return 'database-file:'+text(specification.filename,'SQLite filename');
}
function resourceExists(target,selection,key){
  return (target.resources||[]).some(function(item){
    if(!item)return false;
    var engine;
    try{engine=lifecycle.normalizeEngine(item.engine||item.dialect);}catch(ignore){return false;}
    return engine===selection.engine&&String(item.key||'')===key;
  });
}
function executionFor(target,action){
  return target.provider.actions.indexOf(action)!==-1?'provider':'external';
}
function step(id,action,execution,requirements,notes,evidence){
  return freeze({
    id:id,phase:'initialize',action:action,execution:execution,
    requirements:freeze(Object.assign({
      hostMutation:false,
      elevatedPrivileges:false,
      serviceStartOrRestart:false,
      destructive:false,
      secureBootstrap:true
    },requirements||{})),
    notes:notes||null,
    evidence:evidence?freeze(Object.assign({},evidence)):null
  });
}
function plan(selectionInput,targetInput,specification){
  var selection=lifecycle.validateSelection(selectionInput);
  var target=providers.validateTarget(targetInput);
  specification=specification||{};
  if(!specification||typeof specification!=='object'||Array.isArray(specification))throw new TypeError('NuBloxSQL engine initialization specification must be an object');
  var key=resourceKey(selection,specification);
  var steps=[];

  if(!installed(target,selection)){
    steps.push(step(
      'engine:initialize:prerequisite:'+selection.engine,
      lifecycle.profile(selection.engine).initializationAction,
      'blocked',
      {},
      'The requested engine/runtime version is not reported as installed. Complete and verify engine installation before initialization.',
      {targetVersion:selection.targetVersion}
    ));
  }else if(resourceExists(target,selection,key)){
    steps.push(step(
      'engine:initialize:'+selection.engine,
      lifecycle.profile(selection.engine).initializationAction,
      'satisfied',
      {},
      'The target provider reports that this runtime resource is already initialized.',
      {resourceKey:key}
    ));
  }else{
    var requirements={
      hostMutation:true,
      elevatedPrivileges:selection.engine==='sqlserver',
      serviceStartOrRestart:selection.engine!=='sqlite',
      secureBootstrap:selection.engine==='mysql'?specification.secureBootstrap!==false:true
    };
    if(selection.engine==='mysql'&&specification.secureBootstrap===false){
      requirements.secureBootstrap=false;
    }
    steps.push(step(
      'engine:initialize:'+selection.engine,
      lifecycle.profile(selection.engine).initializationAction,
      executionFor(target,'initialize'),
      requirements,
      selection.engine==='mysql'&&specification.secureBootstrap===false
        ?'MySQL insecure initialization was explicitly requested. The initial administrative account must be secured before production use.'
        :'Initialize the engine-specific runtime resource through the provider or explicit external action.',
      {resourceKey:key,options:freeze(Object.assign({},specification.options||{}))}
    ));
  }

  var blocked=steps.some(function(x){return x.execution==='blocked';});
  if(!blocked){
    steps.push(step(
      'engine:verify-initialize:'+selection.engine,
      'verify-initialize',
      steps[0].execution==='satisfied'?'satisfied':executionFor(target,'verify-initialize'),
      {},
      'Verify engine-specific initialization and readiness before database establishment.',
      {resourceKey:key}
    ));
  }

  var counts={provider:0,external:0,manual:0,satisfied:0,blocked:0};
  steps.forEach(function(x){counts[x.execution]+=1;});
  var core={
    schemaVersion:SCHEMA_VERSION,
    selectionHash:selection.selectionHash,
    targetInspectionHash:target.inspectionHash,
    engine:selection.engine,
    targetVersion:selection.targetVersion,
    targetId:target.targetId,
    provider:target.provider,
    resourceKey:key,
    executable:counts.external===0&&counts.manual===0&&counts.blocked===0,
    requires:freeze({
      hostMutation:steps.some(function(x){return x.requirements.hostMutation;}),
      elevatedPrivileges:steps.some(function(x){return x.requirements.elevatedPrivileges;}),
      serviceStartOrRestart:steps.some(function(x){return x.requirements.serviceStartOrRestart;}),
      secureBootstrap:steps.every(function(x){return x.requirements.secureBootstrap!==false;})
    }),
    summary:freeze(Object.assign({steps:steps.length},counts)),
    steps:freeze(steps)
  };
  return freeze(Object.assign({planHash:hash(core)},core));
}
function validate(value){
  if(!value||value.schemaVersion!==SCHEMA_VERSION||!value.planHash||!value.selectionHash||!value.targetInspectionHash||!Array.isArray(value.steps))throw new TypeError('NuBloxSQL engine initialization plan v'+SCHEMA_VERSION+' required');
  lifecycle.normalizeEngine(value.engine);
  return value;
}

exports.SCHEMA_VERSION=SCHEMA_VERSION;
exports.ACTIONS=ACTIONS;
exports.plan=plan;
exports.validate=validate;
