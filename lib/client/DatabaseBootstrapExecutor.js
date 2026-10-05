'use strict';

var planner = require('./DatabaseBootstrapPlanner');

var SCHEMA_VERSION = 1;
var STATUSES = Object.freeze(['needed','exists','satisfied','manual','deferred','planned','skipped','succeeded','failed','blocked']);

function freeze(value){
  if(!value||typeof value!=='object'||Object.isFrozen(value))return value;
  Object.keys(value).forEach(function(key){freeze(value[key]);});
  return Object.freeze(value);
}

function now(clock){return new Date((clock||Date.now)()).toISOString();}

function assertClient(client,label,dialect){
  if(!client||typeof client!=='object')throw new TypeError('NuBloxSQL database bootstrap requires '+label);
  if(typeof client.execute!=='function'||typeof client.all!=='function')throw new TypeError('NuBloxSQL database bootstrap '+label+' must be a NuBloxSQL-like client');
  if(client.dialect&&String(client.dialect).toLowerCase()!==String(dialect).toLowerCase()){
    throw new Error('NuBloxSQL database bootstrap '+label+' dialect "'+client.dialect+'" does not match plan dialect "'+dialect+'"');
  }
  return client;
}

function rowsPresent(rows){return Array.isArray(rows)&&rows.length>0;}

async function queryPresence(client,check,operation){
  if(!check||!check.sql)return null;
  var rows=await client.all(check.sql,operation||{});
  return rowsPresent(rows);
}

function event(onEvent,type,payload){
  if(typeof onEvent==='function')onEvent(freeze(Object.assign({type:type},payload||{})));
}

function clientForInspection(primary,plan,step,options){
  if(step.scope==='server')return primary;
  if(options&&options.databaseClient)return options.databaseClient;
  if(plan.requires&&plan.requires.databaseClientAfterCreate)return null;
  return primary;
}

async function inspect(serverClient,planInput,options){
  var plan=planner.validate(planInput);
  options=options||{};
  assertClient(serverClient,'server client',plan.targetDialect);
  if(options.databaseClient)assertClient(options.databaseClient,'database client',plan.targetDialect);

  var findings=[];
  for(var i=0;i<plan.steps.length;i+=1){
    var step=plan.steps[i];
    var status;
    var exists=null;
    var client=clientForInspection(serverClient,plan,step,options);

    if(step.execution==='satisfied')status='satisfied';
    else if(step.execution==='manual')status='manual';
    else if(!client)status='deferred';
    else if(step.precondition&&step.precondition.mode==='absent'){
      exists=await queryPresence(client,step.precondition,options.operation);
      status=exists?'exists':'needed';
    }else status='needed';

    findings.push(freeze({
      stepId:step.id,
      kind:step.kind,
      scope:step.scope,
      execution:step.execution,
      status:status,
      exists:exists,
      notes:step.notes||null
    }));
  }

  var summary={
    steps:findings.length,
    needed:0,
    exists:0,
    satisfied:0,
    manual:0,
    deferred:0
  };
  findings.forEach(function(item){if(Object.prototype.hasOwnProperty.call(summary,item.status))summary[item.status]+=1;});

  return freeze({
    schemaVersion:SCHEMA_VERSION,
    planSchemaVersion:plan.schemaVersion,
    planHash:plan.planHash,
    targetDialect:plan.targetDialect,
    targetDatabase:plan.targetDatabase,
    summary:freeze(summary),
    findings:freeze(findings)
  });
}

async function ensureDatabaseClient(serverClient,plan,options,state){
  if(state.databaseClient)return state.databaseClient;
  if(options.databaseClient){
    state.databaseClient=assertClient(options.databaseClient,'database client',plan.targetDialect);
    return state.databaseClient;
  }
  if(typeof options.openDatabaseClient==='function'){
    var opened=await options.openDatabaseClient(freeze({
      serverClient:serverClient,
      plan:plan,
      targetDialect:plan.targetDialect,
      targetDatabase:plan.targetDatabase
    }));
    state.databaseClient=assertClient(opened,'database client returned by openDatabaseClient()',plan.targetDialect);
    state.ownsDatabaseClient=true;
    return state.databaseClient;
  }
  if(plan.requires&&plan.requires.databaseClientAfterCreate)return null;
  state.databaseClient=serverClient;
  return serverClient;
}

async function verifyStep(client,step,options){
  if(!step.verification)return freeze({mode:'none',ok:null});
  var present=await queryPresence(client,step.verification,options.operation);
  var expected=step.verification.mode==='present';
  var ok=expected?present:!present;
  if(!ok){
    var error=new Error('NuBloxSQL database bootstrap verification failed for step '+step.id);
    error.stepId=step.id;
    throw error;
  }
  return freeze({mode:step.verification.mode,ok:true});
}

async function execute(serverClient,planInput,options){
  var plan=planner.validate(planInput);
  options=options||{};
  assertClient(serverClient,'server client',plan.targetDialect);
  if(options.databaseClient)assertClient(options.databaseClient,'database client',plan.targetDialect);

  var state={databaseClient:options.databaseClient||null,ownsDatabaseClient:false};
  var audit=[];
  var startedAt=now(options.clock);
  var status='succeeded';
  var failure=null;
  var blockedReason=null;

  event(options.onEvent,'bootstrap-start',{plan:plan,startedAt:startedAt});

  try{
    for(var i=0;i<plan.steps.length;i+=1){
      var step=plan.steps[i];
      var record={
        stepId:step.id,
        kind:step.kind,
        scope:step.scope,
        execution:step.execution,
        sql:step.sql,
        startedAt:now(options.clock),
        completedAt:null,
        status:null,
        verification:null,
        error:null
      };

      if(step.execution==='satisfied'){
        record.status=options.dryRun===true?'planned':'satisfied';
        record.completedAt=now(options.clock);
        audit.push(freeze(record));
        event(options.onEvent,'step-satisfied',{step:step});
        continue;
      }

      if(step.execution==='manual'){
        if(options.dryRun===true){
          record.status='planned';
          record.completedAt=now(options.clock);
          audit.push(freeze(record));
          event(options.onEvent,'step-planned',{step:step});
          continue;
        }
        if(typeof options.manualHandler!=='function'){
          record.status='blocked';
          record.completedAt=now(options.clock);
          audit.push(freeze(record));
          status='blocked';
          blockedReason='Bootstrap plan contains a manual step and no manualHandler was supplied.';
          event(options.onEvent,'step-blocked',{step:step,reason:blockedReason});
          break;
        }
        try{
          await options.manualHandler(freeze({serverClient:serverClient,databaseClient:state.databaseClient,plan:plan,step:step,index:i}));
          record.status='succeeded';
          record.completedAt=now(options.clock);
          audit.push(freeze(record));
          event(options.onEvent,'step-succeeded',{step:step});
          continue;
        }catch(error){
          record.status='failed';
          record.completedAt=now(options.clock);
          record.error=freeze({name:error.name||'Error',message:error.message||String(error)});
          audit.push(freeze(record));
          status='failed';
          failure={stepId:step.id,error:error};
          event(options.onEvent,'step-failed',{step:step,error:record.error});
          break;
        }
      }

      var client;
      if(step.scope==='server')client=serverClient;
      else client=await ensureDatabaseClient(serverClient,plan,options,state);

      if(!client){
        record.status=options.dryRun===true?'planned':'blocked';
        record.completedAt=now(options.clock);
        audit.push(freeze(record));
        if(options.dryRun!==true){
          status='blocked';
          blockedReason='A database-scoped bootstrap step requires databaseClient or openDatabaseClient after database creation.';
          event(options.onEvent,'step-blocked',{step:step,reason:blockedReason});
          break;
        }
        event(options.onEvent,'step-planned',{step:step});
        continue;
      }

      try{
        var exists=false;
        if(step.precondition&&step.precondition.mode==='absent'){
          exists=await queryPresence(client,step.precondition,options.operation);
        }

        if(exists){
          record.status='skipped';
          record.verification=freeze({mode:'precondition',ok:true});
          record.completedAt=now(options.clock);
          audit.push(freeze(record));
          event(options.onEvent,'step-skipped',{step:step,reason:'already-exists'});
          continue;
        }

        if(options.dryRun===true){
          record.status='planned';
          record.completedAt=now(options.clock);
          audit.push(freeze(record));
          event(options.onEvent,'step-planned',{step:step});
          continue;
        }

        if(typeof options.beforeStep==='function')await options.beforeStep(freeze({client:client,serverClient:serverClient,plan:plan,step:step,index:i}));
        event(options.onEvent,'step-start',{step:step});
        await client.execute(step.sql,options.operation||{});
        record.verification=await verifyStep(client,step,options);
        if(typeof options.afterStep==='function')await options.afterStep(freeze({client:client,serverClient:serverClient,plan:plan,step:step,index:i}));
        record.status='succeeded';
        record.completedAt=now(options.clock);
        audit.push(freeze(record));
        event(options.onEvent,'step-succeeded',{step:step,verification:record.verification});
      }catch(error){
        record.status='failed';
        record.completedAt=now(options.clock);
        record.error=freeze({name:error.name||'Error',message:error.message||String(error)});
        audit.push(freeze(record));
        status='failed';
        failure={stepId:step.id,error:error};
        event(options.onEvent,'step-failed',{step:step,error:record.error});
        break;
      }
    }
  }finally{
    if(state.ownsDatabaseClient&&state.databaseClient&&options.closeOpenedDatabaseClient!==false&&typeof state.databaseClient.close==='function'){
      try{await state.databaseClient.close();}
      catch(closeError){
        if(!failure&&status!=='blocked'){
          status='failed';
          failure={stepId:null,error:closeError};
        }
      }
    }
  }

  if(options.dryRun===true&&status==='succeeded')status='dry-run';
  var result=freeze({
    schemaVersion:SCHEMA_VERSION,
    planSchemaVersion:plan.schemaVersion,
    planHash:plan.planHash,
    status:status,
    dryRun:options.dryRun===true,
    targetDialect:plan.targetDialect,
    targetDatabase:plan.targetDatabase,
    startedAt:startedAt,
    completedAt:now(options.clock),
    audit:freeze(audit),
    error:failure?freeze({name:failure.error.name||'Error',message:failure.error.message||String(failure.error),stepId:failure.stepId||null}):null,
    reason:blockedReason
  });

  event(options.onEvent,'bootstrap-complete',{result:result});
  return result;
}

exports.SCHEMA_VERSION=SCHEMA_VERSION;
exports.STATUSES=STATUSES;
exports.inspect=inspect;
exports.run=execute;
