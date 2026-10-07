'use strict';

var crypto=require('crypto');
var lifecycle=require('./EngineLifecycle');
var providers=require('./InstallationProvider');

var SCHEMA_VERSION=1;
var ACTIONS=Object.freeze(['install-runtime','verify-install','upgrade-required']);

function freeze(value){
  if(!value||typeof value!=='object'||Object.isFrozen(value))return value;
  Object.keys(value).forEach(function(key){freeze(value[key]);});
  return Object.freeze(value);
}
function hash(value){
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
function installedFor(target,engine){
  return (target.installed||[]).filter(function(item){
    return item&&lifecycle.normalizeEngine(item.engine||item.dialect)===engine;
  });
}
function sameVersion(item,selection){
  return String(item.version||'')===String(selection.targetVersion);
}
function executionFor(target,action,strategy){
  if(strategy==='manual')return 'manual';
  if(target.provider.actions.indexOf(action)!==-1)return 'provider';
  return 'external';
}
function step(id,action,execution,requirements,notes,evidence){
  return freeze({
    id:id,
    phase:'install',
    action:action,
    execution:execution,
    requirements:freeze(Object.assign({
      hostMutation:false,
      elevatedPrivileges:false,
      licenseAcceptance:false,
      serviceInterruption:false,
      rebootPossible:false,
      destructive:false
    },requirements||{})),
    notes:notes||null,
    evidence:evidence?freeze(Object.assign({},evidence)):null
  });
}
function plan(selectionInput,targetInput){
  var selection=lifecycle.validateSelection(selectionInput);
  var target=providers.validateTarget(targetInput);
  var installed=installedFor(target,selection.engine);
  var exact=installed.find(function(item){return sameVersion(item,selection);});
  var different=installed.find(function(item){return !sameVersion(item,selection);});
  var steps=[];

  if(exact){
    steps.push(step(
      'engine:install:'+selection.engine,
      'install-runtime','satisfied',{},
      'The requested engine version is already reported as installed by the target provider.',
      {installed:exact}
    ));
  }else if(different){
    steps.push(step(
      'engine:install:'+selection.engine,
      'upgrade-required','blocked',
      {hostMutation:true,serviceInterruption:true},
      'A different version of this engine is already installed. Use an engine-upgrade or explicitly approved side-by-side lifecycle plan instead of treating this as a fresh install.',
      {installed:different,targetVersion:selection.targetVersion}
    ));
  }else{
    steps.push(step(
      'engine:install:'+selection.engine,
      'install-runtime',
      executionFor(target,'install',selection.installationStrategy),
      {
        hostMutation:true,
        elevatedPrivileges:selection.runtimeKind==='server',
        licenseAcceptance:selection.engine==='sqlserver',
        serviceInterruption:false,
        rebootPossible:selection.engine==='sqlserver'
      },
      'Install the selected database engine/runtime using the target provider or an explicit external/manual action.',
      {
        strategy:selection.installationStrategy,
        targetVersion:selection.targetVersion,
        edition:selection.edition,
        distribution:selection.distribution,
        components:selection.components
      }
    ));
  }

  var installBlocked=steps.some(function(x){return x.execution==='blocked';});
  if(!installBlocked){
    steps.push(step(
      'engine:verify-install:'+selection.engine,
      'verify-install',
      exact?'satisfied':executionFor(target,'verify-install',selection.installationStrategy),
      {},
      'Verify that the requested engine/runtime version and required components are present before initialization.',
      {targetVersion:selection.targetVersion}
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
    executable:counts.external===0&&counts.manual===0&&counts.blocked===0,
    requires:freeze({
      hostMutation:steps.some(function(x){return x.requirements.hostMutation;}),
      elevatedPrivileges:steps.some(function(x){return x.requirements.elevatedPrivileges;}),
      licenseAcceptance:steps.some(function(x){return x.requirements.licenseAcceptance;}),
      serviceInterruption:steps.some(function(x){return x.requirements.serviceInterruption;}),
      rebootPossible:steps.some(function(x){return x.requirements.rebootPossible;})
    }),
    summary:freeze(Object.assign({steps:steps.length},counts)),
    steps:freeze(steps)
  };
  return freeze(Object.assign({planHash:hash(core)},core));
}
function validate(value){
  if(!value||value.schemaVersion!==SCHEMA_VERSION||!value.planHash||!value.selectionHash||!value.targetInspectionHash||!Array.isArray(value.steps))throw new TypeError('NuBloxSQL engine installation plan v'+SCHEMA_VERSION+' required');
  lifecycle.normalizeEngine(value.engine);
  return value;
}
function providerSteps(value){validate(value);return freeze(value.steps.filter(function(x){return x.execution==='provider';}));}
function externalSteps(value){validate(value);return freeze(value.steps.filter(function(x){return x.execution==='external'||x.execution==='manual';}));}

exports.SCHEMA_VERSION=SCHEMA_VERSION;
exports.ACTIONS=ACTIONS;
exports.plan=plan;
exports.validate=validate;
exports.providerSteps=providerSteps;
exports.externalSteps=externalSteps;
