'use strict';

var registry = require('./DialectRegistry');
var data = require('./ProfileCapabilityOverlayData');

var SCHEMA_VERSION = 1;
var CHANGE_TYPES = Object.freeze(['add','override','remove']);
var EVIDENCE_LEVELS = Object.freeze(['qualified','documented','declared']);
var RESOLUTIONS = Object.freeze([
  'base-qualified',
  'overlay-qualified',
  'overlay-documented',
  'overlay-declared',
  'inherited-unverified',
  'baseline-unavailable',
  'capability-absent'
]);

function freeze(value){
  if(!value||typeof value!=='object'||Object.isFrozen(value))return value;
  Object.keys(value).forEach(function(key){freeze(value[key]);});
  return Object.freeze(value);
}
function normalizeProfileId(value){
  if(typeof value!=='string'||!value.trim())throw new TypeError('Profile capability overlay requires a profile id');
  var resolved=registry.resolve(value);
  if(!resolved||!resolved.product)throw new RangeError('Unknown dialect/DBMS profile: '+value);
  return resolved.product.id;
}
function compareVersion(left,right){
  if(typeof left!=='string'||typeof right!=='string')return null;
  var a=left.match(/\d+/g),b=right.match(/\d+/g);
  if(!a||!b)return null;
  var n=Math.max(a.length,b.length);
  for(var i=0;i<n;i+=1){
    var av=Number(a[i]||0),bv=Number(b[i]||0);
    if(av<bv)return -1;
    if(av>bv)return 1;
  }
  return 0;
}
function baseDialect(profileId,models){
  var product=registry.product(profileId);
  if(!product)return null;
  if(models[product.dialect])return product.dialect;
  var chain=registry.ancestry(product.profileDialect);
  for(var i=1;i<chain.length;i+=1){
    if(models[chain[i].id])return chain[i].id;
  }
  return null;
}
function collectFeaturePaths(core,object,prefix,out){
  Object.keys(object||{}).forEach(function(key){
    var value=object[key],path=prefix?prefix+'.'+key:key;
    if(core.isFeature(value))out[path]=true;
    else if(value&&typeof value==='object'&&!Array.isArray(value))collectFeaturePaths(core,value,path,out);
  });
  return out;
}
function normalizeChange(core,change){
  if(!change||typeof change!=='object'||Array.isArray(change))throw new TypeError('Profile capability change must be an object');
  if(typeof change.path!=='string'||!change.path.trim())throw new TypeError('Profile capability change requires a path');
  var operation=change.operation||'override';
  if(CHANGE_TYPES.indexOf(operation)===-1)throw new RangeError('Unknown profile capability change operation: '+operation);
  var evidence=change.evidence||'declared';
  if(EVIDENCE_LEVELS.indexOf(evidence)===-1)throw new RangeError('Unknown profile capability evidence level: '+evidence);
  if(operation!=='remove'&&core.SUPPORT_LEVELS.indexOf(change.support)===-1){
    throw new RangeError('Profile capability '+operation+' requires a valid support level');
  }
  var deployments=change.deployments===undefined?[]:change.deployments;
  if(!Array.isArray(deployments)||deployments.some(function(x){return typeof x!=='string'||!x.trim();})){
    throw new TypeError('Profile capability deployments must be an array of non-empty strings');
  }
  var editions=change.editions===undefined?[]:change.editions;
  if(!Array.isArray(editions)||editions.some(function(x){return typeof x!=='string'||!x.trim();})){
    throw new TypeError('Profile capability editions must be an array of non-empty strings');
  }
  return freeze({
    path:change.path.trim(),
    operation:operation,
    support:operation==='remove'?'unsupported':change.support,
    evidence:evidence,
    since:change.since||null,
    until:change.until||null,
    deployments:deployments.slice(),
    editions:editions.slice(),
    nativeName:change.nativeName||null,
    syntax:change.syntax||null,
    standard:change.standard||null,
    references:(change.references||[]).slice(),
    restrictions:(change.restrictions||[]).slice(),
    aliases:(change.aliases||[]).slice(),
    equivalentTo:(change.equivalentTo||[]).slice(),
    notes:change.notes||null
  });
}
function compile(core,models,profileId,specification){
  var id=normalizeProfileId(profileId),product=registry.product(id),baseline=baseDialect(id,models);
  specification=specification||{};
  if(!specification||typeof specification!=='object'||Array.isArray(specification))throw new TypeError('Profile capability overlay specification must be an object');
  var changes=(specification.changes||[]).map(function(change){return normalizeChange(core,change);});
  var knownPaths=Object.create(null);
  if(baseline&&models[baseline])collectFeaturePaths(core,models[baseline],'',knownPaths);
  var seen=Object.create(null);
  changes.forEach(function(change){
    if(change.operation==='add'&&knownPaths[change.path])throw new Error('Profile capability add targets an existing baseline capability: '+change.path);
    if((change.operation==='override'||change.operation==='remove')&&!knownPaths[change.path])throw new Error('Profile capability '+change.operation+' targets a missing baseline capability: '+change.path);
    if(change.operation==='add')knownPaths[change.path]=true;
    var key=change.path+'|'+(change.since||'')+'|'+(change.until||'')+'|'+change.deployments.join(',')+'|'+change.editions.join(',');
    if(seen[key])throw new Error('Duplicate profile capability change: '+change.path);
    seen[key]=true;
  });
  return freeze({
    schemaVersion:SCHEMA_VERSION,
    profileId:id,
    product:product.product,
    canonicalDialect:product.dialect,
    baseDialect:baseline,
    verification:specification.verification||(baseline?(id===baseline?'base-qualified':'inherited-unverified'):'baseline-unavailable'),
    wireProtocol:specification.wireProtocol||product.wireProtocol,
    deployments:(specification.deployments||[]).slice(),
    changes:changes,
    evidence:(specification.evidence||[]).slice()
  });
}
function staticOverlay(core,models,profileId){
  var id=normalizeProfileId(profileId);
  return compile(core,models,id,(data.overlays&&data.overlays[id])||{changes:[]});
}
function changeMatches(change,context){
  context=context||{};
  if((change.since||change.until)&&!context.version)return false;
  if(change.since&&compareVersion(context.version,change.since)<0)return false;
  if(change.until&&compareVersion(context.version,change.until)>0)return false;
  if(change.deployments.length&&!context.deployment)return false;
  if(change.deployments.length&&change.deployments.indexOf(context.deployment)===-1)return false;
  if(change.editions.length&&!context.edition)return false;
  if(change.editions.length&&change.editions.indexOf(context.edition)===-1)return false;
  return true;
}
function selectedChange(overlay,path,context){
  for(var i=overlay.changes.length-1;i>=0;i-=1){
    if(overlay.changes[i].path===path&&changeMatches(overlay.changes[i],context))return overlay.changes[i];
  }
  return null;
}
function overlayFeature(core,change,baseline){
  var options={
    nativeName:change.nativeName||(baseline&&baseline.nativeName)||null,
    since:change.since||(baseline&&baseline.since)||null,
    deprecatedSince:baseline&&baseline.deprecatedSince||null,
    syntax:change.syntax||(baseline&&baseline.syntax)||null,
    standard:change.standard||(baseline&&baseline.standard)||null,
    evidence:change.evidence,
    references:change.references.length?change.references:(baseline&&baseline.references)||[],
    restrictions:change.restrictions.length?change.restrictions:(baseline&&baseline.restrictions)||[],
    aliases:change.aliases.length?change.aliases:(baseline&&baseline.aliases)||[],
    equivalentTo:change.equivalentTo.length?change.equivalentTo:(baseline&&baseline.equivalentTo)||[],
    notes:change.notes||(change.operation==='remove'?'Removed by DBMS profile overlay.':baseline&&baseline.notes)||null
  };
  return core.feature(change.support,options);
}
function resolutionForEvidence(evidence){
  if(evidence==='qualified')return 'overlay-qualified';
  if(evidence==='documented')return 'overlay-documented';
  return 'overlay-declared';
}
function create(core,models){
  function definition(profileId){
    var id=normalizeProfileId(profileId),product=registry.product(id),overlay=staticOverlay(core,models,id);
    return freeze({
      schemaVersion:SCHEMA_VERSION,
      profileId:id,
      vendor:product.vendor,
      product:product.product,
      profileDialect:product.profileDialect,
      canonicalDialect:product.dialect,
      baseDialect:overlay.baseDialect,
      inheritance:registry.ancestry(product.profileDialect).map(function(entry){return entry.id;}),
      driver:product.driver,
      wireProtocol:overlay.wireProtocol,
      verification:overlay.verification,
      changeCount:overlay.changes.length,
      evidence:overlay.evidence
    });
  }
  function status(profileId,path,options){
    if(typeof path!=='string'||!path.trim())throw new TypeError('Profile capability path must be a non-empty string');
    var id=normalizeProfileId(profileId),context=(options&&options.context)||{},overlay=(options&&options.overlay)||staticOverlay(core,models,id);
    if(!overlay||overlay.profileId!==id)throw new TypeError('Profile capability overlay does not match profile '+id);
    var base=overlay.baseDialect&&models[overlay.baseDialect]?core.getPath(models[overlay.baseDialect],path):undefined;
    var baseline=core.isFeature(base)?base:null;
    var change=selectedChange(overlay,path,context);
    if(change){
      if(change.operation==='add'&&baseline)throw new Error('Profile capability add targets an existing baseline capability: '+path);
      if(change.operation==='override'&&!baseline)throw new Error('Profile capability override targets a missing baseline capability: '+path);
      var feature=overlayFeature(core,change,baseline);
      return freeze({
        schemaVersion:SCHEMA_VERSION,profileId:id,path:path,baseDialect:overlay.baseDialect,
        resolution:resolutionForEvidence(change.evidence),available:feature.supported,
        feature:feature,baseline:baseline,change:change,context:freeze(Object.assign({},context))
      });
    }
    if(!overlay.baseDialect){
      return freeze({
        schemaVersion:SCHEMA_VERSION,profileId:id,path:path,baseDialect:null,
        resolution:'baseline-unavailable',available:null,feature:null,baseline:null,change:null,
        context:freeze(Object.assign({},context))
      });
    }
    if(!baseline){
      return freeze({
        schemaVersion:SCHEMA_VERSION,profileId:id,path:path,baseDialect:overlay.baseDialect,
        resolution:'capability-absent',available:false,feature:null,baseline:null,change:null,
        context:freeze(Object.assign({},context))
      });
    }
    if(id===overlay.baseDialect){
      return freeze({
        schemaVersion:SCHEMA_VERSION,profileId:id,path:path,baseDialect:overlay.baseDialect,
        resolution:'base-qualified',available:baseline.supported,feature:baseline,baseline:baseline,change:null,
        context:freeze(Object.assign({},context))
      });
    }
    return freeze({
      schemaVersion:SCHEMA_VERSION,profileId:id,path:path,baseDialect:overlay.baseDialect,
      resolution:'inherited-unverified',available:null,feature:null,baseline:baseline,change:null,
      context:freeze(Object.assign({},context))
    });
  }
  function supports(profileId,path,options){return status(profileId,path,options).available;}
  function diff(profileId,options){
    var id=normalizeProfileId(profileId),overlay=(options&&options.overlay)||staticOverlay(core,models,id);
    return freeze({schemaVersion:SCHEMA_VERSION,profileId:id,baseDialect:overlay.baseDialect,changes:overlay.changes});
  }
  function report(profileId,options){
    var id=normalizeProfileId(profileId),overlay=(options&&options.overlay)||staticOverlay(core,models,id);
    var paths=Object.create(null);
    if(overlay.baseDialect&&models[overlay.baseDialect])collectFeaturePaths(core,models[overlay.baseDialect],'',paths);
    overlay.changes.forEach(function(change){paths[change.path]=true;});
    var summary={total:0,baseQualified:0,overlayQualified:0,overlayDocumented:0,overlayDeclared:0,inheritedUnverified:0,baselineUnavailable:0,capabilityAbsent:0};
    Object.keys(paths).sort().forEach(function(path){
      var item=status(id,path,{overlay:overlay,context:options&&options.context});
      summary.total+=1;
      if(item.resolution==='base-qualified')summary.baseQualified+=1;
      else if(item.resolution==='overlay-qualified')summary.overlayQualified+=1;
      else if(item.resolution==='overlay-documented')summary.overlayDocumented+=1;
      else if(item.resolution==='overlay-declared')summary.overlayDeclared+=1;
      else if(item.resolution==='inherited-unverified')summary.inheritedUnverified+=1;
      else if(item.resolution==='baseline-unavailable')summary.baselineUnavailable+=1;
      else if(item.resolution==='capability-absent')summary.capabilityAbsent+=1;
    });
    return freeze({
      schemaVersion:SCHEMA_VERSION,
      definition:definition(id),
      summary:summary,
      changes:overlay.changes
    });
  }
  function validate(){
    var errors=[];
    if(data.schemaVersion!==SCHEMA_VERSION)errors.push('profile overlay data schema version mismatch');
    Object.keys(data.overlays||{}).forEach(function(id){
      try{compile(core,models,id,data.overlays[id]);}catch(error){errors.push(id+': '+error.message);}
    });
    registry.products.forEach(function(product){
      try{definition(product.id);}catch(error){errors.push(product.id+': '+error.message);}
    });
    return freeze({valid:errors.length===0,schemaVersion:SCHEMA_VERSION,profiles:registry.products.length,officialOverlays:Object.keys(data.overlays||{}).length,errors:errors});
  }

  return freeze({
    SCHEMA_VERSION:SCHEMA_VERSION,
    CHANGE_TYPES:CHANGE_TYPES,
    EVIDENCE_LEVELS:EVIDENCE_LEVELS,
    RESOLUTIONS:RESOLUTIONS,
    definition:definition,
    compile:function(profileId,specification){return compile(core,models,profileId,specification);},
    overlay:function(profileId){return staticOverlay(core,models,profileId);},
    status:status,
    supports:supports,
    diff:diff,
    report:report,
    validate:validate,
    compareVersion:compareVersion
  });
}

exports.SCHEMA_VERSION=SCHEMA_VERSION;
exports.CHANGE_TYPES=CHANGE_TYPES;
exports.EVIDENCE_LEVELS=EVIDENCE_LEVELS;
exports.RESOLUTIONS=RESOLUTIONS;
exports.create=create;
