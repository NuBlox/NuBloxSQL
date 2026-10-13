'use strict';

var assert=require('assert');
var sql=require('..');

function column(table,name,ordinal,type,nullable){
  return {
    kind:'column',database:'app',schema:'public',table:table,name:name,ordinal:ordinal,
    dataType:type,nativeType:type,nullability:nullable?'nullable':'not-null',
    default:null,primaryKey:name==='id',identity:false,
    generated:{enabled:false,kind:null,expression:null},native:{}
  };
}

function metadata(columns){
  return {
    vocabularyVersion:1,dialect:'postgresql',scope:{database:'app',schema:'public'},
    databases:[{kind:'database',name:'app',native:{}}],
    schemas:[{kind:'schema',database:'app',name:'public',native:{}}],
    tables:[{
      kind:'table',database:'app',schema:'public',name:'users',native:{},
      columns:columns,indexes:[],foreignKeys:[],constraints:[]
    }]
  };
}

function planForAdditions(names){
  var left=metadata([column('users','id',1,'integer',false)]);
  var right=metadata([column('users','id',1,'integer',false)]);
  names.forEach(function(name,index){right.tables[0].columns.push(column('users',name,index+2,'text',true));});
  return sql.planMigration(sql.diffSchemas(left,right),{targetDialect:'postgresql'});
}

async function dryRunContract(){
  var plan=planForAdditions(['nickname']);
  var calls=0;
  var client={dialect:'postgresql',execute:async function(){calls+=1;}};
  var result=await sql.executeMigration(client,plan,{dryRun:true});
  assert.strictEqual(result.status,'dry-run');
  assert.strictEqual(calls,0);
  assert.strictEqual(result.audit.length,1);
  assert.strictEqual(result.audit[0].status,'planned');
}

async function approvalContract(){
  var left=metadata([column('users','id',1,'integer',false),column('users','name',2,'text',true)]);
  var right=metadata([column('users','id',1,'integer',false)]);
  var plan=sql.planMigration(sql.diffSchemas(left,right),{targetDialect:'postgresql'});
  var calls=0;
  var client={dialect:'postgresql',execute:async function(){calls+=1;}};

  var blocked=await sql.executeMigration(client,plan);
  assert.strictEqual(blocked.status,'blocked');
  assert.strictEqual(calls,0);

  var approved=await sql.executeMigration(client,plan,{approve:async function(){return true;}});
  assert.strictEqual(approved.status,'succeeded');
  assert.strictEqual(calls,1);
}

async function checkpointResumeContract(){
  var plan=planForAdditions(['alpha','beta']);
  var calls=[];
  var failing={
    dialect:'postgresql',
    execute:async function(statement){
      calls.push(statement);
      if(statement.indexOf('"beta"')!==-1)throw new Error('beta failure');
      return {affectedRows:0};
    }
  };
  var first=await sql.executeMigration(failing,plan,{approval:'none'});
  assert.strictEqual(first.status,'failed');
  assert.deepStrictEqual(Array.from(first.checkpoint.completedStepIds),['migration-step-0001']);
  assert.strictEqual(first.checkpoint.failedStepId,'migration-step-0002');

  var resumedCalls=[];
  var healthy={
    dialect:'postgresql',
    execute:async function(statement){resumedCalls.push(statement);return {affectedRows:0};}
  };
  var resumed=await sql.resumeMigration(healthy,plan,first.checkpoint,{approval:'none'});
  assert.strictEqual(resumed.status,'succeeded');
  assert.strictEqual(resumed.audit[0].status,'skipped');
  assert.strictEqual(resumedCalls.length,1);
  assert.ok(resumedCalls[0].indexOf('"beta"')!==-1);

  var wrong=Object.assign({},first.checkpoint,{targetSemanticHash:'wrong'});
  await assert.rejects(function(){return sql.resumeMigration(healthy,plan,wrong,{approval:'none'});},/target hash mismatch/);
}

async function compensationContract(){
  var plan=planForAdditions(['alpha','beta']);
  var calls=[];
  var client={
    dialect:'postgresql',
    execute:async function(statement){
      calls.push(statement);
      if(statement.indexOf('ADD COLUMN "beta"')!==-1)throw new Error('beta failure');
      return {affectedRows:0};
    }
  };
  var result=await sql.executeMigration(client,plan,{approval:'none',failurePolicy:'compensate'});
  assert.strictEqual(result.status,'failed');
  assert.strictEqual(result.recovery.attempted,true);
  assert.strictEqual(result.recovery.succeeded,true);
  assert.strictEqual(result.recovery.steps.length,1);
  assert.ok(result.recovery.steps[0].sql.indexOf('DROP COLUMN "alpha"')!==-1);
  assert.deepStrictEqual(Array.from(result.checkpoint.completedStepIds),[]);
}

async function dialectGuardContract(){
  var plan=planForAdditions(['nickname']);
  await assert.rejects(function(){
    return sql.executeMigration({dialect:'mysql',execute:async function(){}},plan,{approval:'none'});
  },/does not match client dialect/);
}

async function manualPlanContract(){
  var left=metadata([column('users','id',1,'integer',false)]);
  var right=metadata([column('users','id',1,'integer',false),column('users','tenant_id',2,'integer',false)]);
  var plan=sql.planMigration(sql.diffSchemas(left,right),{targetDialect:'postgresql'});
  var client={dialect:'postgresql',execute:async function(){throw new Error('must not execute');}};
  var blocked=await sql.executeMigration(client,plan,{approval:'none'});
  assert.strictEqual(blocked.status,'blocked');
  assert.strictEqual(blocked.audit.length,0);

  var handled=0;
  var result=await sql.executeMigration(client,plan,{
    approval:'none',
    manualHandler:async function(){handled+=1;}
  });
  assert.strictEqual(result.status,'succeeded');
  assert.strictEqual(handled,1);
}

async function liveSqliteVerificationContract(){
  var source=sql.createClient({dialect:'sqlite',filename:':memory:'});
  var reference=sql.createClient({dialect:'sqlite',filename:':memory:'});
  try{
    await source.execute('CREATE TABLE users (id INTEGER PRIMARY KEY)');
    await reference.execute('CREATE TABLE users (id INTEGER PRIMARY KEY, nickname TEXT)');

    var before=await source.schemaSnapshot({database:'main',schema:'main',deep:true});
    var expected=await reference.schemaSnapshot({database:'main',schema:'main',deep:true});
    var diff=sql.diffSchemas(before,expected);
    var plan=sql.planMigration(diff,{targetDialect:'sqlite'});
    assert.strictEqual(plan.executable,true);

    var checkpoints=[];
    var events=[];
    var result=await source.executeMigration(plan,{
      approval:'none',
      expectedSnapshot:expected,
      snapshotOptions:{database:'main',schema:'main',deep:true},
      onCheckpoint:async function(value){checkpoints.push(value);},
      onEvent:function(value){events.push(value.type);}
    });

    assert.strictEqual(result.status,'succeeded');
    assert.strictEqual(result.verification.mode,'semantic-hash');
    assert.strictEqual(result.verification.ok,true);
    assert.strictEqual(checkpoints.length,1);
    assert.ok(events.indexOf('migration-start')!==-1);
    assert.ok(events.indexOf('step-succeeded')!==-1);
    assert.ok(events.indexOf('migration-complete')!==-1);

    var columns=await source.metadata.columns('users');
    assert.ok(columns.some(function(entry){return entry.name==='nickname';}));
  }finally{
    await source.close();
    await reference.close();
  }
}

async function singleTransactionRollbackContract(){
  var db=sql.createClient({dialect:'sqlite',filename:':memory:'});
  try{
    await db.execute('CREATE TABLE tx_exec (id INTEGER PRIMARY KEY)');
    var plan=Object.freeze({
      schemaVersion:1,
      targetDialect:'sqlite',
      transactionStrategy:'transactional-preferred',
      source:Object.freeze({semanticHash:'source'}),
      target:Object.freeze({semanticHash:'target'}),
      steps:Object.freeze([
        Object.freeze({id:'migration-step-0001',phase:70,status:'added',safety:'safe',execution:'automatic',targetDialect:'sqlite',logicalKey:'a',kind:'column',sql:'ALTER TABLE tx_exec ADD COLUMN value TEXT',preconditions:Object.freeze([]),rollback:Object.freeze({mode:'compensating',sql:'ALTER TABLE tx_exec DROP COLUMN value'}),notes:null}),
        Object.freeze({id:'migration-step-0002',phase:70,status:'added',safety:'safe',execution:'automatic',targetDialect:'sqlite',logicalKey:'b',kind:'column',sql:'ALTER TABLE missing_table ADD COLUMN nope TEXT',preconditions:Object.freeze([]),rollback:null,notes:null})
      ])
    });

    var result=await db.executeMigration(plan,{approval:'none',transactionMode:'single'});
    assert.strictEqual(result.status,'failed');
    assert.strictEqual(result.recovery.attempted,true);
    assert.deepStrictEqual(Array.from(result.checkpoint.completedStepIds),[]);

    var columns=await db.metadata.columns('tx_exec');
    assert.strictEqual(columns.some(function(entry){return entry.name==='value';}),false);
  }finally{
    await db.close();
  }
}


async function directResumeIntegrityContract(){
  var plan=planForAdditions(['alpha','beta']);
  var operations=[];
  var failing={dialect:'postgresql',execute:async function(statement){
    if(statement.indexOf('"beta"')!==-1)throw new Error('deliberate second step failure');
    return {rowCount:0};
  }};
  var result=await sql.executeMigration(failing,plan,{approval:'none'});
  assert.strictEqual(result.status,'failed');
  assert.strictEqual(result.checkpoint.schemaVersion,2);
  assert.strictEqual(result.checkpoint.planHash.length,64);
  var client={dialect:'postgresql',execute:async function(statement){operations.push(statement);return {rowCount:0};}};
  var sameTargetDifferentSql=JSON.parse(JSON.stringify(plan));
  sameTargetDifferentSql.steps[1].sql='DROP TABLE users';
  await assert.rejects(function(){
    return sql.executeMigration(client,sameTargetDifferentSql,{approval:'none',resumeFrom:result.checkpoint});
  },/checkpoint plan hash mismatch/);
  var attempts=[
    Object.assign({},result.checkpoint,{planHash:'f'.repeat(64)}),
    Object.assign({},result.checkpoint,{schemaVersion:1}),
    Object.assign({},result.checkpoint,{completedStepIds:['unknown']}),
    Object.assign({},result.checkpoint,{completedStepIds:['migration-step-0001','migration-step-0001']}),
    Object.assign({},result.checkpoint,{completedStepIds:null}),
    Object.assign({},result.checkpoint,{failedStepId:'unknown'})
  ];
  for(var i=0;i<attempts.length;i++){
    await assert.rejects(function(){
      return sql.executeMigration(client,plan,{approval:'none',resumeFrom:attempts[i]});
    },/checkpoint/);
  }
  assert.strictEqual(operations.length,0,'invalid checkpoint cannot execute any SQL');
  var transactionsStarted=0;
  await assert.rejects(function(){
    return sql.executeMigration({
      dialect:'postgresql',
      transaction:async function(){transactionsStarted++;throw new Error('must not begin');}
    },plan,{
      approval:'none',transactionMode:'single',
      resumeFrom:Object.assign({},result.checkpoint,{planHash:'f'.repeat(64)})
    });
  },/checkpoint plan hash mismatch/);
  assert.strictEqual(transactionsStarted,0,'a forged checkpoint must fail before BEGIN');

  var direct=await sql.executeMigration(client,plan,{approval:'none',resumeFrom:result.checkpoint});
  assert.strictEqual(direct.status,'succeeded');
  assert.strictEqual(direct.audit[0].status,'skipped');
  assert.strictEqual(operations.length,1);
}

async function committedCheckpointContract(){
  var plan=planForAdditions(['alpha','beta']);
  var committed=false;
  var published=[];
  var events=[];
  var database={
    dialect:'postgresql',
    execute:async function(){return {rowCount:0};},
    transaction:async function(run){
      var result=await run({dialect:'postgresql',execute:this.execute});
      committed=true;
      return result;
    }
  };
  var result=await sql.executeMigration(database,plan,{
    approval:'none',transactionMode:'single',
    onCheckpoint:async function(cp){assert.strictEqual(committed,true);published.push(cp);},
    onEvent:function(record){
      if(record.type==='step-succeeded')assert.strictEqual(committed,true);
      events.push(record.type);
    }
  });
  assert.strictEqual(result.status,'succeeded');
  assert.strictEqual(published.length,1);
  assert.deepStrictEqual(Array.from(published[0].completedStepIds),
    ['migration-step-0001','migration-step-0002']);
  assert.strictEqual(published[0].planHash,result.checkpoint.planHash);
  assert.ok(events.includes('step-succeeded'));

  var committedButUnpublished=false;
  await assert.rejects(function(){
    return sql.executeMigration(database,plan,{
      approval:'none',transactionMode:'single',
      onCheckpoint:async function(){
        committedButUnpublished=committed;
        throw new Error('external durable store unavailable');
      }
    });
  },function(error){
    return error.code==='MIGRATION_CHECKPOINT_PUBLICATION_FAILED' &&
      error.migrationResult.status==='succeeded';
  });
  assert.strictEqual(committedButUnpublished,true);

  var rolledBack=false,rollbackPublished=[],rollbackEvents=[];
  var badDatabase={
    dialect:'postgresql',
    transaction:async function(run){
      try{
        return await run({dialect:'postgresql',execute:async function(statement){
          if(statement.includes('"beta"'))throw new Error('simulate rollback');
          return {rowCount:0};
        }});
      }catch(error){rolledBack=true;throw error;}
    }
  };
  var failed=await sql.executeMigration(badDatabase,plan,{
    approval:'none',transactionMode:'single',
    onCheckpoint:async function(cp){rollbackPublished.push(cp);},
    onEvent:function(event){rollbackEvents.push(event.type);}
  });
  assert.strictEqual(rolledBack,true);
  assert.strictEqual(failed.status,'failed');
  assert.strictEqual(rollbackPublished.length,0);
  assert.ok(!rollbackEvents.includes('step-succeeded'));
  assert.deepStrictEqual(Array.from(failed.checkpoint.completedStepIds),[]);
}

Promise.resolve()
  .then(dryRunContract)
  .then(approvalContract)
  .then(checkpointResumeContract)
  .then(directResumeIntegrityContract)
  .then(committedCheckpointContract)
  .then(compensationContract)
  .then(dialectGuardContract)
  .then(manualPlanContract)
  .then(liveSqliteVerificationContract)
  .then(singleTransactionRollbackContract)
  .then(function(){console.log('NuBloxSQL migration execution engine contract: PASS');})
  .catch(function(error){console.error(error&&error.stack?error.stack:error);process.exitCode=1;});
