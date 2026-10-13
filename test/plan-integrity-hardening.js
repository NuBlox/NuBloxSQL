'use strict';

const assert = require('node:assert/strict');
const sql = require('..');
const configurationPlanner = require('../lib/client/administration/DatabaseConfigurationPlanner');
const bootstrapPlanner = require('../lib/client/administration/DatabaseBootstrapPlanner');
const installationPlanner = require('../lib/lifecycle/EngineInstallationPlanner');
const initializationPlanner = require('../lib/lifecycle/EngineInitializationPlanner');

const copy = value => JSON.parse(JSON.stringify(value));

async function configurationPlanIntegrity() {
  const discovery={
    schemaVersion:1,dialect:'postgresql',
    settings:[{name:'work_mem',value:'4096',scope:'session',apply:'immediate',mutable:true,
      restartRequired:false,source:'default',description:null,native:{context:'user'}}],
    summary:{settings:1,mutable:1,immutable:0,restartRequired:0,unknownMutability:0}
  };
  const plan=sql.planDatabaseConfiguration(discovery,{changes:[{name:'work_mem',value:'8192'}]});
  const serialized=copy(plan);
  const checked=configurationPlanner.validate(serialized);
  assert.equal(checked.planHash,plan.planHash);
  assert.notEqual(checked,serialized);
  assert.ok(Object.isFrozen(checked.steps[0]));
  const tampered=copy(plan);
  tampered.steps[0].sql='ALTER SYSTEM SET work_mem = 1000000';
  assert.throws(()=>configurationPlanner.validate(tampered),/plan hash mismatch/);
  assert.throws(()=>sql.configurationAutomaticSteps(tampered),/plan hash mismatch/);
  let calls=0;
  const client={
    dialect:'postgresql',
    async all(){calls++;return [];},
    async execute(){calls++;throw new Error('must not run');}
  };
  await assert.rejects(sql.executeDatabaseConfiguration(client,tampered,{
    approvedPlanHash:plan.planHash,approval:'all'
  }),/plan hash mismatch/);
  assert.equal(calls,0);
  for(const field of ['targetDialect','summary','requires','steps']){
    const forged=copy(plan);
    if(field==='targetDialect')forged[field]='mysql';
    else if(field==='summary')forged.summary.automatic++;
    else if(field==='requires')forged.requires.adminPrivileges=false;
    else forged.steps[0].execution='manual';
    assert.throws(()=>configurationPlanner.validate(forged),/plan hash mismatch/);
  }
}

async function bootstrapPlanIntegrity(){
  const plan=sql.planDatabaseBootstrap({database:'customer',schemas:['app']},{targetDialect:'postgresql'});
  assert.equal(bootstrapPlanner.validate(copy(plan)).planHash,plan.planHash);
  const forged=copy(plan);
  forged.steps[0].sql='DROP DATABASE "customer"';
  assert.throws(()=>bootstrapPlanner.validate(forged),/plan hash mismatch/);
  let calls=0;
  const client={dialect:'postgresql',async all(){calls++;return [];},async execute(){calls++;}};
  await assert.rejects(sql.executeDatabaseBootstrap(client,forged),/plan hash mismatch/);
  assert.equal(calls,0);
  assert.throws(()=>sql.bootstrapAutomaticSteps(forged),/plan hash mismatch/);
}

function provider() {
  return {
    id:'integrity-test-provider',kind:'test',
    actions:['inspect-target','install','verify-install','initialize','verify-initialize'],
    metadata:{},
    async inspectTarget(){
      return {
        targetId:'target-001',
        platform:{os:'linux',family:'debian',architecture:'arm64'},
        installed:[{engine:'postgresql',version:'18',state:'ready'}],
        resources:[]
      };
    }
  };
}

async function enginePlanIntegrity() {
  const p=provider();
  const selected=sql.selectDatabaseEngine({engine:'postgresql',targetVersion:'18'});
  const target=await sql.inspectEngineTarget(p);
  const install=sql.planEngineInstallation(selected,target);
  assert.equal(installationPlanner.validate(copy(install)).planHash,install.planHash);
  const installForged=copy(install);
  installForged.targetId='other-target';
  assert.throws(()=>installationPlanner.validate(installForged),/plan hash mismatch/);
  const installMutated=copy(install);
  installMutated.steps[0].execution='provider';
  assert.throws(()=>installationPlanner.validate(installMutated),/plan hash mismatch/);
  await assert.rejects(sql.executeEngineInstallation(p,installForged,{dryRun:true}),/plan hash mismatch/);

  const initialized=sql.planEngineInitialization(selected,target,{dataDirectory:'/var/lib/postgresql/18/main'});
  assert.equal(initializationPlanner.validate(copy(initialized)).planHash,initialized.planHash);
  const forged=copy(initialized);
  forged.steps[0].requirements.hostMutation=false;
  assert.throws(()=>initializationPlanner.validate(forged),/plan hash mismatch/);
  await assert.rejects(sql.executeEngineInitialization(p,forged,{dryRun:true}),/plan hash mismatch/);
  const resource=copy(initialized);
  resource.resourceKey='cluster:/other';
  assert.throws(()=>initializationPlanner.validate(resource),/plan hash mismatch/);
}

async function checkpointGuards(){
  const plan=Object.freeze({
    schemaVersion:1,targetDialect:'postgresql',transactionStrategy:'transactional-preferred',
    source:Object.freeze({semanticHash:'source-1'}),
    target:Object.freeze({semanticHash:'target-1'}),
    steps:Object.freeze([
      Object.freeze({id:'a',targetDialect:'postgresql',safety:'safe',execution:'automatic',sql:'SELECT 1'}),
      Object.freeze({id:'b',targetDialect:'postgresql',safety:'safe',execution:'automatic',sql:'SELECT 2'})
    ])
  });
  const executed=[];
  const client={dialect:'postgresql',async execute(stmt){executed.push(stmt);return {};}};
  const first=await sql.executeMigration(client,plan,{approval:'none'});
  assert.equal(first.status,'succeeded');
  assert.match(first.checkpoint.planFingerprint,/^[a-f0-9]{64}$/);
  assert.equal(executed.length,2);
  const cp=first.checkpoint;
  async function denied(value,alternatePlan=plan){
    const before=executed.length;
    await assert.rejects(sql.executeMigration(client,alternatePlan,{
      approval:'none',resumeFrom:value
    }),/checkpoint|fingerprint/);
    assert.equal(executed.length,before);
  }
  await denied({ ...cp,completedStepIds:['a','UNPLANNED'] });
  await denied({ ...cp,completedStepIds:['a','a'] });
  await denied({ ...cp,completedStepIds:'a' });
  await denied({ ...cp,completedStepIds:['a'],failedStepId:'a' });
  await denied({ ...cp,completedStepIds:['a'],failedStepId:'not-step' });
  await denied({ ...cp,planFingerprint:'0'.repeat(64) });
  await denied({ ...cp,planFingerprint:undefined });
  await denied({ ...cp,targetDialect:'sqlite' });
  const forgedPlan=copy(plan);
  forgedPlan.steps[0].sql='DROP TABLE customer';
  await denied(cp,forgedPlan);
  await assert.rejects(sql.resumeMigration(client,plan,{...cp,completedStepIds:['unknown']},{approval:'none'}),/unknown step/);

  // A correctly bound checkpoint can resume the exact original plan.
  const resumed=await sql.executeMigration(client,plan,{approval:'none',resumeFrom:cp});
  assert.equal(resumed.status,'succeeded');
  assert.equal(resumed.audit.every(entry=>entry.status==='skipped'),true);
  assert.equal(executed.length,2);
}

async function transactionalCheckpointSafety() {
  const run=async ({fail=false,onCheckpoint,onEvent,commitError=false})=>{
    const database=[];
    const client={
      dialect:'sqlite',
      async execute(sql) { database.push(sql);if(fail&&sql==='SELECT broken')throw Error('simulated DDL failure'); },
      async transaction(fn){
        const result=await fn(this);
        if(commitError)throw Error('commit failed');
        return result;
      }
    };
    const plan={
      schemaVersion:1,targetDialect:'sqlite',transactionStrategy:'transactional-preferred',
      source:{semanticHash:'tx-source'},target:{semanticHash:'tx-target'},
      steps:[
        {id:'step-a',targetDialect:'sqlite',safety:'safe',execution:'automatic',sql:'SELECT 1'},
        {id:'step-b',targetDialect:'sqlite',safety:'safe',execution:'automatic',sql:fail?'SELECT broken':'SELECT 2'}
      ]
    };
    return sql.executeMigration(client,plan,{transactionMode:'single',approval:'none',onCheckpoint,onEvent});
  };
  const checkpoints=[],events=[];
  const failed=await run({
    fail:true,
    onCheckpoint:()=>{checkpoints.push('incorrect precommit checkpoint');},
    onEvent:event=>events.push(event.type)
  });
  assert.equal(failed.status,'failed');
  assert.deepEqual(checkpoints,[]);
  assert.deepEqual(events,['migration-complete']);
  assert.deepEqual(Array.from(failed.checkpoint.completedStepIds),[]);
  const successCheckpoints=[];
  let committed=false;
  await run({
    onCheckpoint:cp=>{successCheckpoints.push(cp);assert.equal(committed,false);}
  });
  assert.equal(successCheckpoints.length,2);
  const noCommit=[];
  await assert.rejects(run({commitError:true,onCheckpoint:cp=>noCommit.push(cp)}),/commit failed/);
  assert.equal(noCommit.length,0);
}


async function transactionBoundarySafety(){
  const plan={
    schemaVersion:1,targetDialect:'sqlite',transactionStrategy:'transactional-preferred',
    source:{semanticHash:'trusted-source'},target:{semanticHash:'trusted-target'},
    steps:[{id:'step-a',targetDialect:'sqlite',safety:'safe',execution:'automatic',sql:'SELECT 1'}]
  };
  let began=0,committed=false,executed=0;
  const client={
    dialect:'sqlite',
    async execute(){executed++;return {};},
    async transaction(fn){
      began++;
      const result=await fn(this);
      committed=true;
      return result;
    }
  };
  const good=await sql.executeMigration(client,plan,{approval:'none'});
  assert.equal(good.status,'succeeded');

  const bad={...good.checkpoint,planFingerprint:'0'.repeat(64)};
  began=0;executed=0;
  await assert.rejects(sql.executeMigration(client,plan,{
    approval:'none',transactionMode:'single',resumeFrom:bad
  }),/checkpoint plan fingerprint mismatch/);
  assert.equal(began,0,'forged checkpoint must fail before a transaction begins');
  assert.equal(executed,0);

  committed=false;
  await assert.rejects(sql.executeMigration(client,plan,{
    approval:'none',transactionMode:'single',
    onCheckpoint:async()=>{
      assert.equal(committed,true);
      throw new Error('checkpoint store temporarily unavailable');
    }
  }),error=>{
    assert.equal(error.code,'MIGRATION_POST_COMMIT_NOTIFICATION_FAILED');
    assert.equal(error.migrationCommitted,true);
    assert.equal(error.migrationResult.status,'succeeded');
    assert.match(error.cause.message,/checkpoint store/);
    return true;
  });
  assert.equal(committed,true,'post-commit callback failure may not imply rollback');
  committed=false;
  await assert.rejects(sql.executeMigration(client,plan,{
    approval:'none',transactionMode:'single',
    onEvent:event=>{
      if(event.type==='step-succeeded'){
        assert.equal(committed,true);
        throw new Error('log sink unavailable');
      }
    }
  }),error=>error.code==='MIGRATION_POST_COMMIT_NOTIFICATION_FAILED' &&
    error.migrationResult.status==='succeeded');
}

(async()=>{
  await configurationPlanIntegrity();
  await bootstrapPlanIntegrity();
  await enginePlanIntegrity();
  await checkpointGuards();
  await transactionalCheckpointSafety();
  await transactionBoundarySafety();
  console.log('NuBloxSQL plan hash and migration checkpoint integrity: PASS');
})().catch(error=>{console.error(error.stack||error);process.exitCode=1;});
