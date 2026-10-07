'use strict';

var lifecycle=require('./EngineLifecycle');
var providers=require('./InstallationProvider');
var installationPlanner=require('./EngineInstallationPlanner');
var initializationPlanner=require('./EngineInitializationPlanner');

var SCHEMA_VERSION=1;
var STATUSES=Object.freeze([
  'dry-run','succeeded','failed','blocked','drifted',
  'pending-restart','pending-reboot','pending-verification'
]);
var STEP_STATUSES=Object.freeze([
  'planned','satisfied','succeeded','failed','blocked',
  'pending-restart','pending-reboot','pending-verification'
]);
var APPROVAL_MODES=Object.freeze(['required','none']);
var ACTION_RESULT_STATUSES=Object.freeze([
  'succeeded','failed','blocked','pending-restart','pending-reboot','pending-verification'
]);

function freeze(value){
  if(!value||typeof value!=='object'||Object.isFrozen(value))return value;
  if(typeof ArrayBuffer!=='undefined'&&ArrayBuffer.isView&&ArrayBuffer.isView(value))return value;
  Object.keys(value).forEach(function(key){freeze(value[key]);});
  return Object.freeze(value);
}
function context(value){return Object.freeze(value);}
function now(clock){return new Date((clock||Date.now)()).toISOString();}
function errorValue(error){
  if(!error)return null;
  return freeze({name:error.name||'Error',message:error.message||String(error)});
}
function event(onEvent,type,payload){
  if(typeof onEvent==='function')onEvent(freeze(Object.assign({type:type},payload||{})));
}
function secretLike(key){
  return /password|passwd|pwd|secret|token|credential|private[_-]?key|encryption[_-]?key/i.test(String(key));
}
function assertNoSecrets(value,path){
  if(value===null||value===undefined)return;
  if(Array.isArray(value)){
    value.forEach(function(item,index){assertNoSecrets(item,path+'['+index+']');});
    return;
  }
  if(typeof value!=='object')return;
  if(typeof ArrayBuffer!=='undefined'&&ArrayBuffer.isView&&ArrayBuffer.isView(value))return;
  Object.keys(value).forEach(function(key){
    if(secretLike(key))throw new Error('NuBloxSQL lifecycle provider audit evidence must not contain secret-like field "'+path+'.'+key+'"');
    assertNoSecrets(value[key],path+'.'+key);
  });
}
function planKind(plan){
  if(!plan||!Array.isArray(plan.steps)||!plan.steps.length)return null;
  var phase=plan.steps[0].phase;
  if(!plan.steps.every(function(step){return step.phase===phase;}))return null;
  return phase==='install'?'installation':phase==='initialize'?'initialization':null;
}
function validatePlan(plan,expected){
  var kind=planKind(plan);
  if(kind!==expected)throw new TypeError('NuBloxSQL engine lifecycle '+expected+' plan required');
  return expected==='installation'
    ?installationPlanner.validate(plan)
    :initializationPlanner.validate(plan);
}
function validateProvider(provider,plan){
  providers.validate(provider);
  var descriptor=providers.descriptor(provider);
  if(descriptor.id!==plan.provider.id||descriptor.kind!==plan.provider.kind){
    throw new Error('NuBloxSQL engine lifecycle provider identity does not match the provider captured by the plan');
  }
  return descriptor;
}
function approval(plan,options){
  var mode=options.approvalMode||'required';
  if(APPROVAL_MODES.indexOf(mode)===-1)throw new RangeError('NuBloxSQL engine lifecycle approvalMode must be required or none');
  if(mode==='none')return freeze({mode:mode,approved:true,planHashMatched:null});
  var matched=options.approvedPlanHash===plan.planHash;
  return freeze({mode:mode,approved:matched,planHashMatched:matched});
}
function licenseAcceptance(plan,options){
  var required=!!(plan.requires&&plan.requires.licenseAcceptance);
  var supplied=options.licenseAcceptance;
  var accepted=!!(supplied&&supplied.accepted===true);
  var reference=supplied&&supplied.reference!==undefined&&supplied.reference!==null
    ?String(supplied.reference)
    :null;
  return freeze({required:required,accepted:required?accepted:null,reference:reference});
}
function inspectionRequest(plan,purpose){
  return freeze({
    purpose:purpose,
    phase:planKind(plan),
    planHash:plan.planHash,
    engine:plan.engine,
    targetVersion:plan.targetVersion,
    targetId:plan.targetId
  });
}
async function preflight(provider,plan){
  validateProvider(provider,plan);
  var current=await providers.inspect(provider,inspectionRequest(plan,'preflight'));
  var drift=[];
  if(current.targetId!==plan.targetId){
    drift.push(freeze({
      reason:'target-id-changed',
      expected:plan.targetId,
      actual:current.targetId
    }));
  }
  if(current.inspectionHash!==plan.targetInspectionHash){
    drift.push(freeze({
      reason:'target-state-changed',
      expected:plan.targetInspectionHash,
      actual:current.inspectionHash
    }));
  }
  return freeze({current:current,drift:freeze(drift)});
}
async function inspect(provider,planInput,kind){
  var plan=validatePlan(planInput,kind);
  var checked=await preflight(provider,plan);
  return freeze({
    schemaVersion:SCHEMA_VERSION,
    planSchemaVersion:plan.schemaVersion,
    planHash:plan.planHash,
    kind:kind,
    engine:plan.engine,
    targetVersion:plan.targetVersion,
    targetId:plan.targetId,
    plannedInspectionHash:plan.targetInspectionHash,
    currentInspectionHash:checked.current.inspectionHash,
    drift:checked.drift,
    current:checked.current
  });
}
function normalizeActionResult(value,label){
  if(!value||typeof value!=='object'||Array.isArray(value)){
    throw new TypeError('NuBloxSQL '+label+' must return a lifecycle action result object');
  }
  var status=String(value.status||'');
  if(ACTION_RESULT_STATUSES.indexOf(status)===-1){
    throw new RangeError('NuBloxSQL '+label+' status must be one of: '+ACTION_RESULT_STATUSES.join(', '));
  }
  var evidence=null;
  if(value.evidence!==undefined&&value.evidence!==null){
    if(typeof value.evidence!=='object'||Array.isArray(value.evidence)){
      throw new TypeError('NuBloxSQL '+label+' evidence must be an object when provided');
    }
    evidence=Object.assign({},value.evidence);
    assertNoSecrets(evidence,'evidence');
  }
  return freeze({
    status:status,
    message:value.message===undefined||value.message===null?null:String(value.message),
    reference:value.reference===undefined||value.reference===null?null:String(value.reference),
    evidence:evidence?freeze(evidence):null
  });
}
function mutationAction(step){
  if(step.action==='install-runtime')return 'install';
  if(
    step.action==='initialize-cluster'||
    step.action==='initialize-data-directory'||
    step.action==='initialize-instance'||
    step.action==='initialize-database-file'
  )return 'initialize';
  return null;
}
function verificationAction(step){
  if(step.action==='verify-install')return 'verify-install';
  if(step.action==='verify-initialize')return 'verify-initialize';
  return null;
}
async function resolveInputs(options,plan,step,index){
  if(typeof options.resolveInputs!=='function')return null;
  var value=await options.resolveInputs(freeze({
    phase:step.phase,
    action:mutationAction(step),
    planHash:plan.planHash,
    stepId:step.id,
    engine:plan.engine,
    targetVersion:plan.targetVersion,
    targetId:plan.targetId,
    index:index
  }));
  if(value===undefined||value===null)return null;
  if(typeof value!=='object'||Array.isArray(value))throw new TypeError('NuBloxSQL lifecycle resolveInputs() must return an object, null or undefined');
  return Object.freeze(Object.assign({},value));
}
function actionRequest(plan,step,providerAction,inputs,license){
  return context({
    schemaVersion:SCHEMA_VERSION,
    action:providerAction,
    phase:step.phase,
    planHash:plan.planHash,
    selectionHash:plan.selectionHash,
    targetInspectionHash:plan.targetInspectionHash,
    stepId:step.id,
    engine:plan.engine,
    targetVersion:plan.targetVersion,
    targetId:plan.targetId,
    requirements:step.requirements,
    evidence:step.evidence,
    licenseAcceptance:license.required
      ?Object.freeze({accepted:license.accepted===true,reference:license.reference})
      :null,
    inputs:inputs
  });
}
async function executeMutation(provider,plan,step,index,options,license){
  var providerAction=mutationAction(step);
  if(!providerAction)throw new Error('NuBloxSQL lifecycle step '+step.id+' is not an executable mutation action');

  if(step.execution==='provider'){
    var inputs=await resolveInputs(options,plan,step,index);
    if(plan.provider.actions.indexOf(providerAction)===-1){
      return freeze({status:'blocked',message:'The planned provider does not declare lifecycle action "'+providerAction+'".',reference:null,evidence:null});
    }
    if(typeof provider.executeAction!=='function'){
      return freeze({status:'blocked',message:'The installation provider does not implement executeAction(request).',reference:null,evidence:null});
    }
    var result=await provider.executeAction(actionRequest(plan,step,providerAction,inputs,license));
    return normalizeActionResult(result,'installation provider executeAction()');
  }

  var handler=step.execution==='manual'?options.manualHandler:options.externalHandler;
  if(typeof handler!=='function'){
    return freeze({
      status:'blocked',
      message:'Lifecycle '+step.execution+' step requires '+(step.execution==='manual'?'manualHandler':'externalHandler')+'.',
      reference:null,
      evidence:null
    });
  }
  var inputs=await resolveInputs(options,plan,step,index);
  var handled=await handler(context({
    provider:provider,
    plan:plan,
    step:step,
    index:index,
    inputs:inputs
  }));
  return normalizeActionResult(handled,step.execution+' lifecycle handler');
}
function installedMatch(current,plan){
  var installStep=plan.steps.find(function(step){return step.action==='install-runtime';});
  var expected=installStep&&installStep.evidence||{};
  var requiredComponents=Array.isArray(expected.components)?expected.components:[];
  return (current.installed||[]).find(function(item){
    if(item.engine!==plan.engine||String(item.version)!==String(plan.targetVersion)||item.state!=='ready')return false;
    if(expected.edition!==null&&expected.edition!==undefined&&String(item.edition||'')!==String(expected.edition))return false;
    if(expected.distribution!==null&&expected.distribution!==undefined&&String(item.distribution||'')!==String(expected.distribution))return false;
    return requiredComponents.every(function(component){return item.components.indexOf(component)!==-1;});
  })||null;
}
function resourceMatch(current,plan){
  return (current.resources||[]).find(function(item){
    return item.engine===plan.engine&&item.key===plan.resourceKey&&item.state==='ready';
  })||null;
}
async function verify(provider,plan,step){
  var current=await providers.inspect(provider,inspectionRequest(plan,verificationAction(step)));
  if(current.targetId!==plan.targetId){
    return freeze({
      mode:'target-reinspection',
      action:step.action,
      ok:false,
      inspectionHash:current.inspectionHash,
      reason:'target-id-changed',
      evidence:null
    });
  }
  if(step.action==='verify-install'){
    var installed=installedMatch(current,plan);
    return freeze({
      mode:'target-reinspection',
      action:step.action,
      ok:!!installed,
      inspectionHash:current.inspectionHash,
      reason:installed?null:'requested-runtime-not-ready',
      evidence:installed
    });
  }
  if(step.action==='verify-initialize'){
    var resource=resourceMatch(current,plan);
    var runtime=installedMatch(current,plan);
    return freeze({
      mode:'target-reinspection',
      action:step.action,
      ok:!!resource&&!!runtime,
      inspectionHash:current.inspectionHash,
      reason:resource&&runtime?null:(!runtime?'requested-runtime-not-ready':'initialized-resource-not-ready'),
      evidence:resource
    });
  }
  throw new Error('NuBloxSQL lifecycle verification step "'+step.action+'" is unsupported');
}
function baseResult(plan,kind,status,dryRun,startedAt,completedAt,approvalValue,licenseValue,preflightValue,audit,error,reason){
  return freeze({
    schemaVersion:SCHEMA_VERSION,
    planSchemaVersion:plan.schemaVersion,
    planHash:plan.planHash,
    kind:kind,
    status:status,
    dryRun:dryRun,
    engine:plan.engine,
    targetVersion:plan.targetVersion,
    targetId:plan.targetId,
    approval:approvalValue,
    licenseAcceptance:licenseValue,
    preflight:preflightValue?freeze({
      plannedInspectionHash:plan.targetInspectionHash,
      currentInspectionHash:preflightValue.current.inspectionHash,
      drift:preflightValue.drift
    }):null,
    startedAt:startedAt,
    completedAt:completedAt,
    audit:freeze(audit.slice()),
    error:error?freeze({
      name:error.name||'Error',
      message:error.message||String(error),
      stepId:error.stepId||null
    }):null,
    reason:reason||null
  });
}
async function run(provider,planInput,kind,options){
  var plan=validatePlan(planInput,kind);
  options=options||{};
  validateProvider(provider,plan);
  var dryRun=options.dryRun===true;
  var startedAt=now(options.clock);
  var approvalValue=approval(plan,options);
  var licenseValue=licenseAcceptance(plan,options);
  var audit=[];
  var preflightValue=null;

  event(options.onEvent,'engine-lifecycle-execution-start',{kind:kind,plan:plan,startedAt:startedAt,dryRun:dryRun});

  try{
    if(!dryRun&&!approvalValue.approved){
      var approvalDone=now(options.clock);
      return baseResult(
        plan,kind,'blocked',false,startedAt,approvalDone,approvalValue,licenseValue,null,audit,null,
        'Engine lifecycle execution requires approvedPlanHash to exactly match the immutable planHash.'
      );
    }
    if(!dryRun&&licenseValue.required&&!licenseValue.accepted){
      var licenseDone=now(options.clock);
      return baseResult(
        plan,kind,'blocked',false,startedAt,licenseDone,approvalValue,licenseValue,null,audit,null,
        'This engine installation plan requires explicit license acceptance evidence before execution.'
      );
    }

    preflightValue=await preflight(provider,plan);
    if(preflightValue.drift.length){
      var driftDone=now(options.clock);
      var driftResult=baseResult(
        plan,kind,'drifted',dryRun,startedAt,driftDone,approvalValue,licenseValue,preflightValue,audit,null,
        'Engine target state changed after planning; reinspect the target and build a fresh plan.'
      );
      event(options.onEvent,'engine-lifecycle-execution-complete',{result:driftResult});
      return driftResult;
    }

    if(dryRun){
      plan.steps.forEach(function(step){
        audit.push(freeze({
          stepId:step.id,
          phase:step.phase,
          action:step.action,
          execution:step.execution,
          startedAt:startedAt,
          completedAt:startedAt,
          status:'planned',
          result:null,
          verification:null,
          error:null
        }));
      });
      var dryDone=now(options.clock);
      var dryResult=baseResult(plan,kind,'dry-run',true,startedAt,dryDone,approvalValue,licenseValue,preflightValue,audit,null,null);
      event(options.onEvent,'engine-lifecycle-execution-complete',{result:dryResult});
      return dryResult;
    }

    for(var i=0;i<plan.steps.length;i+=1){
      var step=plan.steps[i];
      var record={
        stepId:step.id,
        phase:step.phase,
        action:step.action,
        execution:step.execution,
        startedAt:now(options.clock),
        completedAt:null,
        status:null,
        result:null,
        verification:null,
        error:null
      };
      event(options.onEvent,'engine-lifecycle-step-start',{kind:kind,step:step,index:i});

      if(step.execution==='blocked'){
        record.status='blocked';
        record.completedAt=now(options.clock);
        audit.push(freeze(record));
        var blockedDone=now(options.clock);
        var blockedResult=baseResult(
          plan,kind,'blocked',false,startedAt,blockedDone,approvalValue,licenseValue,preflightValue,audit,null,
          step.notes||'Engine lifecycle plan contains a blocked step.'
        );
        event(options.onEvent,'engine-lifecycle-execution-complete',{result:blockedResult});
        return blockedResult;
      }

      if(step.execution==='satisfied'){
        record.status='satisfied';
        record.completedAt=now(options.clock);
        audit.push(freeze(record));
        event(options.onEvent,'engine-lifecycle-step-complete',{step:step,index:i,status:record.status});
        continue;
      }

      if(typeof options.beforeStep==='function'){
        await options.beforeStep(context({provider:provider,plan:plan,step:step,index:i}));
      }

      if(verificationAction(step)){
        var verification=await verify(provider,plan,step);
        record.verification=verification;
        record.status=verification.ok?'succeeded':'failed';
        record.completedAt=now(options.clock);
        audit.push(freeze(record));
        event(options.onEvent,'engine-lifecycle-step-complete',{step:step,index:i,status:record.status});
        if(!verification.ok){
          var verifyError=new Error('NuBloxSQL engine lifecycle verification failed for step '+step.id+': '+verification.reason);
          verifyError.stepId=step.id;
          var verifyDone=now(options.clock);
          return baseResult(
            plan,kind,'failed',false,startedAt,verifyDone,approvalValue,licenseValue,preflightValue,audit,verifyError,
            'Post-action target reinspection did not prove the planned state.'
          );
        }
      }else{
        var outcome=await executeMutation(provider,plan,step,i,options,licenseValue);
        record.result=outcome;
        record.status=outcome.status==='succeeded'?'succeeded':outcome.status;
        record.completedAt=now(options.clock);
        audit.push(freeze(record));
        event(options.onEvent,'engine-lifecycle-step-complete',{step:step,index:i,status:record.status});

        if(outcome.status==='failed'){
          var actionError=new Error(outcome.message||'NuBloxSQL engine lifecycle provider action failed');
          actionError.stepId=step.id;
          var failedDone=now(options.clock);
          return baseResult(plan,kind,'failed',false,startedAt,failedDone,approvalValue,licenseValue,preflightValue,audit,actionError,null);
        }
        if(outcome.status==='blocked'){
          var handlerBlockedDone=now(options.clock);
          return baseResult(plan,kind,'blocked',false,startedAt,handlerBlockedDone,approvalValue,licenseValue,preflightValue,audit,null,outcome.message);
        }
        if(outcome.status==='pending-restart'||outcome.status==='pending-reboot'||outcome.status==='pending-verification'){
          var pendingDone=now(options.clock);
          return baseResult(
            plan,kind,outcome.status,false,startedAt,pendingDone,approvalValue,licenseValue,preflightValue,audit,null,
            (outcome.message?outcome.message+' ':'')+'Complete the external lifecycle boundary, reinspect the target and build a fresh plan before continuing.'
          );
        }
      }

      if(typeof options.afterStep==='function'){
        await options.afterStep(context({provider:provider,plan:plan,step:step,index:i,audit:audit[audit.length-1]}));
      }
    }

    var completedAt=now(options.clock);
    var result=baseResult(plan,kind,'succeeded',false,startedAt,completedAt,approvalValue,licenseValue,preflightValue,audit,null,null);
    event(options.onEvent,'engine-lifecycle-execution-complete',{result:result});
    return result;
  }catch(error){
    var failedAt=now(options.clock);
    var last=audit.length?audit[audit.length-1]:null;
    if(!error.stepId&&last)error.stepId=last.stepId;
    var failed=baseResult(plan,kind,'failed',dryRun,startedAt,failedAt,approvalValue,licenseValue,preflightValue,audit,error,null);
    event(options.onEvent,'engine-lifecycle-execution-complete',{result:failed});
    return failed;
  }
}

exports.SCHEMA_VERSION=SCHEMA_VERSION;
exports.STATUSES=STATUSES;
exports.STEP_STATUSES=STEP_STATUSES;
exports.APPROVAL_MODES=APPROVAL_MODES;
exports.ACTION_RESULT_STATUSES=ACTION_RESULT_STATUSES;
exports.inspectInstallation=function(provider,plan){return inspect(provider,plan,'installation');};
exports.inspectInitialization=function(provider,plan){return inspect(provider,plan,'initialization');};
exports.executeInstallation=function(provider,plan,options){return run(provider,plan,'installation',options);};
exports.executeInitialization=function(provider,plan,options){return run(provider,plan,'initialization',options);};
