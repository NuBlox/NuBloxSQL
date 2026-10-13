'use strict';

var planner=require('./DatabaseConfigurationPlanner');
var configuration=require('./DatabaseConfiguration');

var SCHEMA_VERSION=1;
var STATUSES=Object.freeze(['dry-run','succeeded','failed','blocked','drifted','pending-verification']);
var STEP_STATUSES=Object.freeze(['planned','satisfied','succeeded','failed','blocked','pending-verification']);
var APPROVAL_MODES=Object.freeze(['required','none']);

function freeze(value){
  if(!value||typeof value!=='object'||Object.isFrozen(value))return value;
  Object.keys(value).forEach(function(key){freeze(value[key]);});
  return Object.freeze(value);
}
function now(clock){return new Date((clock||Date.now)()).toISOString();}
function context(value){return Object.freeze(value);}
function sameValue(left,right){
  if(left===right)return true;
  if(left===null||left===undefined||right===null||right===undefined)return false;
  return String(left)===String(right);
}
function quoteLiteral(value){return "'"+String(value).replace(/'/g,"''")+"'";}

function assertClient(client,dialect,label){
  label=label||'client';
  if(!client||typeof client!=='object'||typeof client.all!=='function'||typeof client.execute!=='function'){
    throw new TypeError('NuBloxSQL configuration execution '+label+' must be a NuBloxSQL-like client');
  }
  if(client.dialect&&String(client.dialect).toLowerCase()!==String(dialect).toLowerCase()){
    throw new Error('NuBloxSQL configuration execution '+label+' dialect "'+client.dialect+'" does not match plan dialect "'+dialect+'"');
  }
  return client;
}
function event(onEvent,type,payload){
  if(typeof onEvent==='function')onEvent(freeze(Object.assign({type:type},payload||{})));
}
function errorValue(error){
  if(!error)return null;
  return freeze({name:error.name||'Error',message:error.message||String(error)});
}

async function discover(client,options){
  return configuration.discover(client,{operation:options.operation||{}});
}

async function preflight(client,plan,options){
  var report=await discover(client,options);
  var drift=[];
  var checked=0;
  plan.steps.forEach(function(step){
    if(step.action!=='set'||step.execution==='satisfied')return;
    checked+=1;
    var current=configuration.find(report,step.name);
    if(!current){
      drift.push(freeze({stepId:step.id,name:step.name,expected:step.from,actual:null,reason:'setting-missing'}));
      return;
    }
    var actual=current.effectiveValue!==undefined?current.effectiveValue:current.value;
    if(!sameValue(actual,step.from)){
      drift.push(freeze({stepId:step.id,name:step.name,expected:step.from,actual:actual,reason:'value-changed'}));
    }
  });
  return freeze({checkedSettings:checked,drift:freeze(drift),report:report});
}

async function verifyPostgresFile(client,verification,options){
  var rows=await client.all(
    'SELECT setting, applied, error, sourcefile, sourceline, seqno FROM pg_file_settings WHERE name = '+quoteLiteral(verification.name)+' ORDER BY seqno DESC',
    options.operation||{}
  );
  if(!Array.isArray(rows)||!rows.length){
    return freeze({mode:verification.mode,name:verification.name,expected:verification.value,actual:null,ok:false,deferred:false,error:null});
  }
  var row=rows[0];
  return freeze({
    mode:verification.mode,
    name:verification.name,
    expected:verification.value,
    actual:row.setting,
    ok:sameValue(row.setting,verification.value),
    deferred:false,
    error:row.error?freeze({name:'PostgreSQLConfigurationError',message:String(row.error)}):null,
    native:freeze(Object.assign({},row))
  });
}

async function verifyDiscovery(client,verification,options){
  var report=await discover(client,options);
  var current=configuration.find(report,verification.name);
  if(!current){
    return freeze({mode:verification.mode,name:verification.name,expected:verification.value,actual:null,ok:false,deferred:false,error:null});
  }
  var actual=verification.mode==='configured-setting-equals'
    ?current.configuredValue
    :current.effectiveValue;
  if(actual===undefined)actual=current.value;
  return freeze({
    mode:verification.mode,
    name:verification.name,
    expected:verification.value,
    actual:actual,
    ok:sameValue(actual,verification.value),
    deferred:false,
    error:null
  });
}

async function verifyStep(client,step,options){
  if(!step.verification)return freeze({mode:'none',name:null,expected:null,actual:null,ok:null,deferred:false,error:null});
  try{
    if(step.verification.mode==='postgres-file-setting-equals'){
      return await verifyPostgresFile(client,step.verification,options);
    }
    if(step.verification.mode==='effective-setting-equals'||step.verification.mode==='configured-setting-equals'){
      return await verifyDiscovery(client,step.verification,options);
    }
    return freeze({
      mode:step.verification.mode,
      name:step.verification.name||null,
      expected:step.verification.value,
      actual:null,
      ok:null,
      deferred:true,
      error:freeze({name:'UnsupportedVerificationMode',message:'Unsupported configuration verification mode "'+step.verification.mode+'"'})
    });
  }catch(error){
    return freeze({
      mode:step.verification.mode,
      name:step.verification.name||null,
      expected:step.verification.value,
      actual:null,
      ok:null,
      deferred:true,
      error:errorValue(error)
    });
  }
}

async function replaceForVerification(state,plan,step,options){
  if(!step.requirements||step.requirements.reconnectRequired!==true)return state.activeClient;
  if(typeof options.openVerificationClient!=='function')return null;
  var opened=await options.openVerificationClient(context({
    client:state.activeClient,
    originalClient:state.originalClient,
    plan:plan,
    step:step,
    targetDialect:plan.targetDialect
  }));
  assertClient(opened,plan.targetDialect,'client returned by openVerificationClient()');
  if(opened===state.activeClient){
    throw new Error('NuBloxSQL configuration openVerificationClient() must return a fresh client when reconnect is required');
  }
  if(state.ownsActiveClient&&state.activeClient&&typeof state.activeClient.close==='function'){
    await state.activeClient.close();
  }
  state.activeClient=opened;
  state.ownsActiveClient=true;
  return opened;
}

function approval(plan,options){
  var mode=options.approvalMode||'required';
  if(APPROVAL_MODES.indexOf(mode)===-1)throw new RangeError('NuBloxSQL configuration approvalMode must be required or none');
  if(mode==='none')return freeze({mode:mode,approved:true,planHashMatched:null});
  var matched=options.approvedPlanHash===plan.planHash;
  return freeze({mode:mode,approved:matched,planHashMatched:matched});
}

function baseResult(plan,status,dryRun,startedAt,completedAt,approvalValue,preflightValue,audit,error,reason){
  return freeze({
    schemaVersion:SCHEMA_VERSION,
    planSchemaVersion:plan.schemaVersion,
    planHash:plan.planHash,
    status:status,
    dryRun:dryRun,
    targetDialect:plan.targetDialect,
    startedAt:startedAt,
    completedAt:completedAt,
    approval:approvalValue,
    preflight:preflightValue?freeze({
      checkedSettings:preflightValue.checkedSettings,
      drift:preflightValue.drift
    }):null,
    audit:freeze(audit.slice()),
    error:error?freeze({
      name:error.name||'Error',
      message:error.message||String(error),
      stepId:error.stepId||null
    }):null,
    reason:reason||null
  });
}

async function inspect(client,planInput,options){
  var plan=planner.validate(planInput);
  options=options||{};
  assertClient(client,plan.targetDialect,'client');
  var checked=await preflight(client,plan,options);
  return freeze({
    schemaVersion:SCHEMA_VERSION,
    planSchemaVersion:plan.schemaVersion,
    planHash:plan.planHash,
    targetDialect:plan.targetDialect,
    checkedSettings:checked.checkedSettings,
    drift:checked.drift,
    current:checked.report
  });
}

async function run(client,planInput,options){
  var plan=planner.validate(planInput);
  options=options||{};
  assertClient(client,plan.targetDialect,'client');
  var dryRun=options.dryRun===true;
  var startedAt=now(options.clock);
  var approvalValue=approval(plan,options);
  var audit=[];
  var preflightValue=null;
  var state={originalClient:client,activeClient:client,ownsActiveClient:false};

  event(options.onEvent,'configuration-execution-start',{plan:plan,startedAt:startedAt,dryRun:dryRun});

  try{
    if(!dryRun&&!approvalValue.approved){
      var approvalDone=now(options.clock);
      var approvalResult=baseResult(
        plan,'blocked',false,startedAt,approvalDone,approvalValue,null,audit,null,
        'Configuration execution requires approvedPlanHash to exactly match the immutable planHash.'
      );
      event(options.onEvent,'configuration-execution-complete',{result:approvalResult});
      return approvalResult;
    }

    preflightValue=await preflight(state.activeClient,plan,options);
    if(preflightValue.drift.length){
      var driftDone=now(options.clock);
      var driftResult=baseResult(
        plan,'drifted',dryRun,startedAt,driftDone,approvalValue,preflightValue,audit,null,
        'Configuration state changed after planning; rebuild the plan from fresh discovery before execution.'
      );
      event(options.onEvent,'configuration-execution-complete',{result:driftResult});
      return driftResult;
    }

    if(dryRun){
      plan.steps.forEach(function(step){
        audit.push(freeze({
          stepId:step.id,
          action:step.action,
          name:step.name,
          execution:step.execution,
          sql:step.sql,
          startedAt:startedAt,
          completedAt:startedAt,
          status:'planned',
          verification:null,
          error:null
        }));
      });
      var dryDone=now(options.clock);
      var dryResult=baseResult(plan,'dry-run',true,startedAt,dryDone,approvalValue,preflightValue,audit,null,null);
      event(options.onEvent,'configuration-execution-complete',{result:dryResult});
      return dryResult;
    }

    var pending=false;
    for(var i=0;i<plan.steps.length;i+=1){
      var step=plan.steps[i];
      var record={
        stepId:step.id,
        action:step.action,
        name:step.name,
        execution:step.execution,
        sql:step.sql,
        startedAt:now(options.clock),
        completedAt:null,
        status:null,
        verification:null,
        error:null
      };

      event(options.onEvent,'configuration-step-start',{plan:plan,step:step,index:i});

      if(step.execution==='satisfied'){
        record.status='satisfied';
        record.completedAt=now(options.clock);
        audit.push(freeze(record));
        event(options.onEvent,'configuration-step-complete',{step:step,index:i,status:record.status});
        continue;
      }

      if(typeof options.beforeStep==='function'){
        await options.beforeStep(context({client:state.activeClient,plan:plan,step:step,index:i}));
      }

      if(step.execution==='manual'){
        if(typeof options.manualHandler!=='function'){
          record.status='blocked';
          record.completedAt=now(options.clock);
          audit.push(freeze(record));
          var blockedDone=now(options.clock);
          var blockedResult=baseResult(
            plan,'blocked',false,startedAt,blockedDone,approvalValue,preflightValue,audit,null,
            'Configuration plan contains a manual step; provide manualHandler to continue.'
          );
          event(options.onEvent,'configuration-execution-complete',{result:blockedResult});
          return blockedResult;
        }
        await options.manualHandler(context({
          client:state.activeClient,
          plan:plan,
          step:step,
          index:i
        }));
      }else{
        await state.activeClient.execute(step.sql,options.operation||{});
      }

      var verificationClient=await replaceForVerification(state,plan,step,options);
      if(step.requirements&&step.requirements.reconnectRequired===true&&!verificationClient){
        record.status='pending-verification';
        record.verification=freeze({
          mode:step.verification?step.verification.mode:'none',
          name:step.verification?step.verification.name:null,
          expected:step.verification?step.verification.value:null,
          actual:null,
          ok:null,
          deferred:true,
          error:null
        });
        record.completedAt=now(options.clock);
        audit.push(freeze(record));
        pending=true;
        event(options.onEvent,'configuration-step-complete',{step:step,index:i,status:record.status});
        break;
      }

      var verified=await verifyStep(verificationClient||state.activeClient,step,options);
      record.verification=verified;
      if(verified.ok===false){
        record.status='failed';
        record.completedAt=now(options.clock);
        var mismatch=new Error('NuBloxSQL configuration verification failed for step '+step.id);
        mismatch.stepId=step.id;
        record.error=errorValue(mismatch);
        audit.push(freeze(record));
        var verifyDone=now(options.clock);
        var verifyResult=baseResult(plan,'failed',false,startedAt,verifyDone,approvalValue,preflightValue,audit,mismatch,'Post-change verification did not match the planned value.');
        event(options.onEvent,'configuration-execution-complete',{result:verifyResult});
        return verifyResult;
      }
      if(verified.ok===null||verified.deferred===true){
        record.status='pending-verification';
        pending=true;
      }else{
        record.status='succeeded';
      }

      if(typeof options.afterStep==='function'){
        await options.afterStep(context({
          client:state.activeClient,
          plan:plan,
          step:step,
          index:i,
          verification:verified
        }));
      }

      record.completedAt=now(options.clock);
      audit.push(freeze(record));
      event(options.onEvent,'configuration-step-complete',{step:step,index:i,status:record.status});

      if(record.status==='pending-verification')break;
    }

    var completedAt=now(options.clock);
    var finalStatus=pending?'pending-verification':'succeeded';
    var result=baseResult(
      plan,finalStatus,false,startedAt,completedAt,approvalValue,preflightValue,audit,null,
      pending?'Configuration change was applied but requires fresh-session/restart verification before it can be reported as succeeded.':null
    );
    event(options.onEvent,'configuration-execution-complete',{result:result});
    return result;
  }catch(error){
    var failedAt=now(options.clock);
    var last=audit.length?audit[audit.length-1]:null;
    if(!error.stepId&&last)error.stepId=last.stepId;
    var failed=baseResult(plan,'failed',dryRun,startedAt,failedAt,approvalValue,preflightValue,audit,error,null);
    event(options.onEvent,'configuration-execution-complete',{result:failed});
    return failed;
  }finally{
    if(state.ownsActiveClient&&options.closeOpenedVerificationClient!==false&&state.activeClient&&typeof state.activeClient.close==='function'){
      try{await state.activeClient.close();}catch(ignore){}
    }
  }
}

exports.SCHEMA_VERSION=SCHEMA_VERSION;
exports.STATUSES=STATUSES;
exports.STEP_STATUSES=STEP_STATUSES;
exports.APPROVAL_MODES=APPROVAL_MODES;
exports.inspect=inspect;
exports.run=run;
