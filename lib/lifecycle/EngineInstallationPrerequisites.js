'use strict';

var crypto=require('crypto');
var lifecycle=require('./EngineLifecycle');
var providers=require('./InstallationProvider');

var SCHEMA_VERSION=1;
var STATUSES=Object.freeze(['ready','attention','blocked']);

function freeze(value){
  if(!value||typeof value!=='object'||Object.isFrozen(value))return value;
  Object.keys(value).forEach(function(key){freeze(value[key]);});
  return Object.freeze(value);
}
function hash(value){
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
function check(id,status,summary,evidence){
  if(STATUSES.indexOf(status)===-1)throw new RangeError('NuBloxSQL engine prerequisite status is invalid: '+status);
  return freeze({
    id:id,
    status:status,
    summary:summary,
    evidence:evidence===undefined?null:freeze(evidence)
  });
}
function toolNames(value){
  return Array.isArray(value)?value.map(function(item){return item&&item.name?String(item.name):null;}).filter(Boolean):[];
}
function installed(target,engine){
  return (target.installed||[]).filter(function(item){return item&&item.engine===engine;});
}
function overall(checks){
  if(checks.some(function(item){return item.status==='blocked';}))return 'blocked';
  if(checks.some(function(item){return item.status==='attention';}))return 'attention';
  return 'ready';
}
function summarize(checks){
  var summary={total:checks.length,ready:0,attention:0,blocked:0};
  checks.forEach(function(item){summary[item.status]+=1;});
  return freeze(summary);
}
function assess(selectionInput,targetInput){
  var selection=lifecycle.validateSelection(selectionInput);
  var target=providers.validateTarget(targetInput);
  var facts=target.facts||{};
  var packageManagers=toolNames(facts.packageManagers);
  var containerRuntimes=toolNames(facts.containerRuntimes);
  var checks=[];

  var family=target.platform&&target.platform.family||null;
  checks.push(check(
    'platform-evidence',
    family&&['linux','windows','macos'].indexOf(family)!==-1?'ready':'attention',
    family?'Target platform family is '+family+'.':'Target platform family could not be normalized.',
    {family:family,os:target.platform&&target.platform.os||null,version:target.platform&&target.platform.version||null}
  ));

  var architecture=target.platform&&target.platform.architecture||null;
  checks.push(check(
    'architecture-evidence',
    architecture?'ready':'attention',
    architecture?'Target architecture is '+architecture+'.':'Target architecture is unknown.',
    {architecture:architecture}
  ));

  var exact=installed(target,selection.engine).find(function(item){
    return String(item.version)===String(selection.targetVersion)&&item.state==='ready';
  });
  var incomplete=installed(target,selection.engine).find(function(item){
    return String(item.version)===String(selection.targetVersion)&&item.state!=='ready';
  });
  var different=installed(target,selection.engine).find(function(item){
    return String(item.version)!==String(selection.targetVersion);
  });

  if(exact){
    checks.push(check(
      'existing-runtime',
      'ready',
      'The requested engine lifecycle version is already reported ready on the target.',
      {version:exact.version,state:exact.state}
    ));
  }else if(incomplete){
    checks.push(check(
      'existing-runtime',
      'blocked',
      'The requested engine lifecycle version exists but is not ready; complete the external lifecycle boundary before planning another install.',
      {version:incomplete.version,state:incomplete.state}
    ));
  }else if(different){
    checks.push(check(
      'existing-runtime',
      'blocked',
      'A different engine lifecycle version is already installed; use upgrade or explicit side-by-side planning.',
      {installedVersion:different.version,targetVersion:selection.targetVersion,state:different.state}
    ));
  }else{
    checks.push(check(
      'existing-runtime',
      'ready',
      'No conflicting installed version was discovered.',
      {targetVersion:selection.targetVersion}
    ));
  }

  var strategy=selection.installationStrategy;
  if(strategy==='package'){
    checks.push(check(
      'installation-strategy',
      packageManagers.length?'ready':'attention',
      packageManagers.length
        ?'Package installation tooling was discovered.'
        :'Package strategy selected but no supported package-management command was discovered by this provider.',
      {strategy:strategy,packageManagers:freeze(packageManagers.slice())}
    ));
  }else if(strategy==='container'){
    checks.push(check(
      'installation-strategy',
      containerRuntimes.length?'ready':'attention',
      containerRuntimes.length
        ?'Container runtime tooling was discovered.'
        :'Container strategy selected but Docker/Podman was not discovered by this provider.',
      {strategy:strategy,containerRuntimes:freeze(containerRuntimes.slice())}
    ));
  }else if(strategy==='setup'){
    checks.push(check(
      'installation-strategy',
      family==='windows'?'ready':'blocked',
      family==='windows'
        ?'Setup strategy is structurally compatible with a Windows target.'
        :'Setup strategy requires a Windows target; choose the engine-appropriate package/container/manual path for this platform.',
      {strategy:strategy,platformFamily:family}
    ));
  }else if(strategy==='source'){
    checks.push(check(
      'installation-strategy',
      'attention',
      'Source installation requires a build-toolchain assessment that is not yet part of local-host v1.',
      {strategy:strategy}
    ));
  }else if(strategy==='manual'){
    checks.push(check(
      'installation-strategy',
      'attention',
      'Manual installation was explicitly selected; NuBloxSQL cannot prove the external installation mechanism from target inspection alone.',
      {strategy:strategy}
    ));
  }else{
    checks.push(check(
      'installation-strategy',
      'ready',
      'The selected installation strategy has no additional local-host v1 tooling prerequisite.',
      {strategy:strategy}
    ));
  }

  var needsElevation=selection.runtimeKind==='server'&&(strategy==='package'||strategy==='setup');
  if(needsElevation){
    checks.push(check(
      'elevation',
      target.elevated===true?'ready':'attention',
      target.elevated===true
        ?'Current process is reported elevated.'
        :(target.elevated===false?'Installation is likely to require an elevation boundary.':'Elevation state could not be determined.'),
      {elevated:target.elevated}
    ));
  }else{
    checks.push(check('elevation','ready','No mandatory elevation assumption is made for this strategy.',{elevated:target.elevated}));
  }

  var providerCanInstall=target.provider.actions.indexOf('install')!==-1;
  checks.push(check(
    'execution-provider',
    exact||providerCanInstall?'ready':'attention',
    exact
      ?'No installation mutation is required for the discovered ready runtime.'
      :(providerCanInstall?'The selected provider declares installation execution.':'The inspected provider is read-only for installation; a separate mutation provider or external handler is required.'),
    {providerId:target.provider.id,providerKind:target.provider.kind,installAction:providerCanInstall}
  ));

  if(selection.engine==='sqlserver'){
    checks.push(check(
      'license-acceptance',
      exact?'ready':'attention',
      exact
        ?'The requested SQL Server lifecycle version is already installed; no new installation acceptance gate is required by this plan.'
        :'SQL Server installation execution requires explicit license-acceptance evidence.',
      {required:!exact}
    ));
  }

  checks.push(check(
    'vendor-support-certification',
    'attention',
    'Local-host v1 does not certify vendor support matrices. Confirm the selected version/edition/distribution against current vendor platform requirements before mutation.',
    {
      engine:selection.engine,
      targetVersion:selection.targetVersion,
      platformFamily:family,
      architecture:architecture
    }
  ));

  var status=overall(checks);
  var core={
    schemaVersion:SCHEMA_VERSION,
    selectionHash:selection.selectionHash,
    targetInspectionHash:target.inspectionHash,
    engine:selection.engine,
    targetVersion:selection.targetVersion,
    targetId:target.targetId,
    status:status,
    summary:summarize(checks),
    checks:freeze(checks)
  };
  return freeze(Object.assign({assessmentHash:hash(core)},core));
}
function validate(value){
  if(!value||value.schemaVersion!==SCHEMA_VERSION||!value.assessmentHash||!Array.isArray(value.checks)){
    throw new TypeError('NuBloxSQL engine installation prerequisite assessment v'+SCHEMA_VERSION+' required');
  }
  if(STATUSES.indexOf(value.status)===-1)throw new RangeError('NuBloxSQL engine installation prerequisite assessment status is invalid');
  return value;
}

exports.SCHEMA_VERSION=SCHEMA_VERSION;
exports.STATUSES=STATUSES;
exports.assess=assess;
exports.validate=validate;
