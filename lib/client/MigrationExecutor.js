'use strict';

var migrationPlanner = require('./MigrationPlanner');

var SCHEMA_VERSION = 1;
var STATUSES = Object.freeze(['planned','skipped','running','succeeded','failed','manual','blocked']);
var APPROVAL_MODES = Object.freeze(['none','risky','all']);
var FAILURE_POLICIES = Object.freeze(['stop','compensate']);
var TRANSACTION_MODES = Object.freeze(['none','single']);

function freeze(value){
  if(!value||typeof value!=='object'||Object.isFrozen(value))return value;
  Object.keys(value).forEach(function(key){freeze(value[key]);});
  return Object.freeze(value);
}

function now(clock){
  return new Date((clock||Date.now)()).toISOString();
}

function validatePlan(plan){
  if(!plan||plan.schemaVersion!==migrationPlanner.SCHEMA_VERSION||!Array.isArray(plan.steps)){
    throw new TypeError('NuBloxSQL migration execution requires a migration plan v'+migrationPlanner.SCHEMA_VERSION);
  }
  return plan;
}

function approvalRequired(step,mode){
  if(mode==='all')return true;
  if(mode==='none')return false;
  return step.safety!=='safe';
}

function completedMap(resumeFrom){
  var map=Object.create(null);
  if(!resumeFrom)return map;
  var steps=Array.isArray(resumeFrom.completedStepIds)?resumeFrom.completedStepIds:[];
  steps.forEach(function(id){map[String(id)]=true;});
  return map;
}

function checkpoint(plan,completedStepIds,failedStepId){
  return freeze({
    schemaVersion:SCHEMA_VERSION,
    migrationPlanSchemaVersion:plan.schemaVersion,
    targetDialect:plan.targetDialect,
    sourceSemanticHash:plan.source&&plan.source.semanticHash||null,
    targetSemanticHash:plan.target&&plan.target.semanticHash||null,
    completedStepIds:freeze(completedStepIds.slice()),
    failedStepId:failedStepId||null
  });
}

function event(onEvent,type,payload){
  if(typeof onEvent==='function')onEvent(freeze(Object.assign({type:type},payload||{})));
}

async function verifyTarget(client,plan,options){
  if(options&&typeof options.verify==='function'){
    var custom=await options.verify({client:client,plan:plan});
    if(custom===false)throw new Error('NuBloxSQL migration verification failed');
    return freeze({mode:'custom',ok:true,result:custom===undefined?null:custom});
  }
  if(options&&options.expectedSnapshot){
    if(!client||typeof client.schemaSnapshot!=='function')throw new Error('NuBloxSQL migration verification requires client.schemaSnapshot()');
    var actual=await client.schemaSnapshot(options.snapshotOptions||{deep:true});
    var expected=options.expectedSnapshot;
    var expectedHash=expected.semanticHash||null;
    var ok=!!expectedHash&&actual.semanticHash===expectedHash;
    if(!ok){
      var error=new Error('NuBloxSQL migration post-verification semantic hash mismatch');
      error.expectedSemanticHash=expectedHash;
      error.actualSemanticHash=actual.semanticHash;
      throw error;
    }
    return freeze({mode:'semantic-hash',ok:true,expectedSemanticHash:expectedHash,actualSemanticHash:actual.semanticHash});
  }
  return freeze({mode:'none',ok:null});
}

async function executeStep(client,step,options,context){
  if(options.dryRun===true){
    return freeze({status:'planned',result:null,notes:step.notes||null});
  }

  if(step.execution==='manual'){
    if(typeof options.manualHandler!=='function'){
      return freeze({status:'manual',result:null,notes:step.notes||'Manual migration step requires a handler.'});
    }
    var manualResult=await options.manualHandler({client:client,step:step,context:context});
    return freeze({status:'succeeded',result:manualResult===undefined?null:manualResult,notes:step.notes||null});
  }

  if(!step.sql)throw new Error('NuBloxSQL automatic migration step is missing SQL');

  var approvalMode=options.approval||'risky';
  if(APPROVAL_MODES.indexOf(approvalMode)<0)throw new RangeError('NuBloxSQL migration approval must be none, risky, or all');

  if(approvalRequired(step,approvalMode)){
    if(typeof options.approve!=='function'){
      return freeze({status:'blocked',result:null,notes:'Approval required for '+step.safety+' migration step.'});
    }
    var approved=await options.approve({client:client,step:step,context:context});
    if(approved!==true)return freeze({status:'blocked',result:null,notes:'Migration step approval was not granted.'});
  }

  if(typeof options.beforeStep==='function')await options.beforeStep({client:client,step:step,context:context});
  var result=await client.execute(step.sql,options.operation||{});
  if(typeof options.afterStep==='function')await options.afterStep({client:client,step:step,result:result,context:context});
  return freeze({status:'succeeded',result:result,notes:step.notes||null});
}

async function run(client,planInput,options){
  var plan=validatePlan(planInput);
  options=options||{};
  if(!client||typeof client.execute!=='function')throw new TypeError('NuBloxSQL migration execution requires a NuBloxSQL client');
  if(client.dialect&&String(client.dialect).toLowerCase()!==String(plan.targetDialect).toLowerCase()){
    throw new Error('NuBloxSQL migration target dialect "'+plan.targetDialect+'" does not match client dialect "'+client.dialect+'"');
  }
  var failurePolicy=options.failurePolicy||'stop';
  if(FAILURE_POLICIES.indexOf(failurePolicy)<0)throw new RangeError('NuBloxSQL migration failurePolicy must be stop or compensate');
  var transactionMode=options.transactionMode||'none';
  if(TRANSACTION_MODES.indexOf(transactionMode)<0)throw new RangeError('NuBloxSQL migration transactionMode must be none or single');
  if(transactionMode==='single'&&plan.transactionStrategy!=='transactional-preferred')throw new Error('NuBloxSQL migration plan does not support single-transaction execution');

  var resume=completedMap(options.resumeFrom);
  var completed=[];
  Object.keys(resume).forEach(function(id){completed.push(id);});
  completed.sort();
  var effectiveCompleted=completed.slice();

  var audit=[];
  var blocked=false;
  var failed=null;
  var clock=options.clock||Date.now;

  if(plan.steps.some(function(step){return step.execution==='manual';})&&typeof options.manualHandler!=='function'&&options.dryRun!==true){
    return freeze({
      schemaVersion:SCHEMA_VERSION,
      status:'blocked',
      dryRun:false,
      targetDialect:plan.targetDialect,
      startedAt:now(clock),
      completedAt:now(clock),
      checkpoint:checkpoint(plan,completed,null),
      audit:freeze([]),
      verification:freeze({mode:'none',ok:null}),
      recovery:freeze({attempted:false,succeeded:null,steps:freeze([]),error:null}),
      error:null,
      reason:'Migration plan contains manual steps and no manualHandler was supplied.'
    });
  }

  var startedAt=now(clock);
  event(options.onEvent,'migration-start',{plan:plan,startedAt:startedAt});

  for(var i=0;i<plan.steps.length;i+=1){
    var step=plan.steps[i];
    var record={
      stepId:step.id,
      logicalKey:step.logicalKey,
      safety:step.safety,
      execution:step.execution,
      sql:step.sql,
      startedAt:null,
      completedAt:null,
      status:null,
      error:null
    };

    if(resume[step.id]){
      record.status='skipped';
      record.startedAt=now(clock);
      record.completedAt=record.startedAt;
      audit.push(freeze(record));
      event(options.onEvent,'step-skipped',{step:step});
      continue;
    }

    record.startedAt=now(clock);
    record.status='running';
    event(options.onEvent,'step-start',{step:step});

    try{
      var outcome=await executeStep(client,step,options,{plan:plan,index:i,completedStepIds:completed.slice()});
      record.completedAt=now(clock);
      record.status=outcome.status;
      audit.push(freeze(record));

      if(outcome.status==='blocked'||outcome.status==='manual'){
        blocked=true;
        event(options.onEvent,'step-blocked',{step:step,status:outcome.status,notes:outcome.notes});
        break;
      }

      if(outcome.status==='succeeded'){
        completed.push(step.id);
        effectiveCompleted.push(step.id);
        var cp=checkpoint(plan,effectiveCompleted,null);
        if(typeof options.onCheckpoint==='function')await options.onCheckpoint(cp,{client:client,plan:plan,step:step,index:i});
        event(options.onEvent,'step-succeeded',{step:step,checkpoint:cp});
      }else if(outcome.status==='planned'){
        event(options.onEvent,'step-planned',{step:step});
      }
    }catch(error){
      record.completedAt=now(clock);
      record.status='failed';
      record.error=freeze({name:error.name||'Error',message:error.message||String(error)});
      audit.push(freeze(record));
      failed={stepId:step.id,error:error};
      event(options.onEvent,'step-failed',{step:step,error:record.error});
      break;
    }
  }

  var verification=freeze({mode:'none',ok:null});
  if(!failed&&!blocked&&options.dryRun!==true){
    try{
      verification=await verifyTarget(client,plan,options);
    }catch(error){
      failed={stepId:null,error:error};
      event(options.onEvent,'verification-failed',{error:freeze({name:error.name||'Error',message:error.message||String(error)})});
    }
  }

  var recovery=freeze({attempted:false,succeeded:null,steps:freeze([]),error:null});
  if(failed&&failurePolicy==='compensate'&&options.dryRun!==true){
    var recoverySteps=[];
    var recoveryError=null;
    for(var r=completed.length-1;r>=0;r-=1){
      var completedId=completed[r];
      var original=plan.steps.find(function(entry){return entry.id===completedId;});
      if(!original||!original.rollback||!original.rollback.sql)continue;
      try{
        await client.execute(original.rollback.sql,options.operation||{});
        recoverySteps.push(freeze({stepId:completedId,status:'succeeded',sql:original.rollback.sql}));
        effectiveCompleted=effectiveCompleted.filter(function(id){return id!==completedId;});
      }catch(rollbackError){
        recoveryError=rollbackError;
        recoverySteps.push(freeze({stepId:completedId,status:'failed',sql:original.rollback.sql,error:freeze({name:rollbackError.name||'Error',message:rollbackError.message||String(rollbackError)})}));
        break;
      }
    }
    recovery=freeze({
      attempted:true,
      succeeded:recoveryError?false:true,
      steps:freeze(recoverySteps),
      error:recoveryError?freeze({name:recoveryError.name||'Error',message:recoveryError.message||String(recoveryError)}):null
    });
  }

  var status=failed?'failed':(blocked?'blocked':(options.dryRun===true?'dry-run':'succeeded'));
  var completedAt=now(clock);
  var result=freeze({
    schemaVersion:SCHEMA_VERSION,
    status:status,
    dryRun:options.dryRun===true,
    targetDialect:plan.targetDialect,
    startedAt:startedAt,
    completedAt:completedAt,
    checkpoint:checkpoint(plan,effectiveCompleted,failed&&failed.stepId),
    audit:freeze(audit.slice()),
    verification:verification,
    recovery:recovery,
    error:failed?freeze({name:failed.error.name||'Error',message:failed.error.message||String(failed.error),stepId:failed.stepId||null}):null,
    reason:blocked?'Migration execution stopped at a blocked/manual step.':null
  });

  event(options.onEvent,'migration-complete',{result:result});
  return result;
}

async function runSingleTransaction(client,plan,options){
  var txOptions=options&&options.transactionOptions||{};
  var inner=Object.assign({},options||{},{transactionMode:'none',failurePolicy:'stop'});
  try{
    return await client.transaction(async function(tx){
      var result=await run(tx,plan,inner);
      if(result.status==='failed'||result.status==='blocked'){
        var error=new Error('NuBloxSQL single-transaction migration did not complete successfully');
        error.migrationResult=result;
        throw error;
      }
      return result;
    },txOptions);
  }catch(error){
    if(error&&error.migrationResult){
      var failedResult=error.migrationResult;
      return freeze(Object.assign({},failedResult,{
        checkpoint:checkpoint(plan,[],failedResult.checkpoint&&failedResult.checkpoint.failedStepId),
        recovery:freeze({attempted:true,succeeded:true,steps:freeze([]),error:null}),
        reason:'Single-transaction execution was rolled back.'
      }));
    }
    throw error;
  }
}

async function execute(client,plan,options){
  options=options||{};
  if(options.transactionMode==='single')return runSingleTransaction(client,plan,options);
  return run(client,plan,options);
}

function validateCheckpoint(plan,value){
  if(!value||value.schemaVersion!==SCHEMA_VERSION)throw new TypeError('NuBloxSQL migration checkpoint v'+SCHEMA_VERSION+' required');
  if(value.migrationPlanSchemaVersion!==plan.schemaVersion)throw new Error('NuBloxSQL migration checkpoint plan schema version mismatch');
  if(value.targetDialect!==plan.targetDialect)throw new Error('NuBloxSQL migration checkpoint target dialect mismatch');
  if((value.sourceSemanticHash||null)!==(plan.source&&plan.source.semanticHash||null))throw new Error('NuBloxSQL migration checkpoint source hash mismatch');
  if((value.targetSemanticHash||null)!==(plan.target&&plan.target.semanticHash||null))throw new Error('NuBloxSQL migration checkpoint target hash mismatch');
  var ids=Object.create(null);
  plan.steps.forEach(function(step){ids[step.id]=true;});
  (value.completedStepIds||[]).forEach(function(id){if(!ids[id])throw new Error('NuBloxSQL migration checkpoint references unknown step '+id);});
  return value;
}

async function resume(client,plan,checkpointValue,options){
  validatePlan(plan);
  validateCheckpoint(plan,checkpointValue);
  options=Object.assign({},options||{},{resumeFrom:checkpointValue});
  return execute(client,plan,options);
}

exports.SCHEMA_VERSION=SCHEMA_VERSION;
exports.STATUSES=STATUSES;
exports.APPROVAL_MODES=APPROVAL_MODES;
exports.FAILURE_POLICIES=FAILURE_POLICIES;
exports.TRANSACTION_MODES=TRANSACTION_MODES;
exports.run=execute;
exports.resume=resume;
exports.checkpoint=checkpoint;
