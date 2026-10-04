'use strict';

var assert=require('assert');
var sql=require('..');

function column(table,name,ordinal,type,nullable,def){
  return {
    kind:'column',database:'app',schema:'public',table:table,name:name,ordinal:ordinal,
    dataType:type,nativeType:type,nullability:nullable?'nullable':'not-null',
    default:def===undefined?null:def,primaryKey:name==='id',identity:false,
    generated:{enabled:false,kind:null,expression:null},native:{}
  };
}

function snapshot(dialect,idType){
  return {
    vocabularyVersion:1,dialect:dialect,scope:{database:'app',schema:'public'},
    databases:[{kind:'database',name:'app',native:{}}],
    schemas:[{kind:'schema',database:'app',name:'public',native:{}}],
    tables:[{
      kind:'table',database:'app',schema:'public',name:'users',native:{},
      columns:[
        column('users','id',1,idType,false),
        column('users','name',2,'text',true)
      ],
      indexes:[],foreignKeys:[],constraints:[]
    }]
  };
}

(function emptyPlan(){
  var diff=sql.diffSchemas(snapshot('postgresql','integer'),snapshot('postgresql','integer'));
  var plan=sql.planMigration(diff);
  assert.strictEqual(sql.MIGRATION_PLAN_SCHEMA_VERSION,1);
  assert.strictEqual(plan.steps.length,0);
  assert.strictEqual(plan.executable,true);
  assert.strictEqual(plan.highestSafety,'safe');
  assert.strictEqual(plan.transactionStrategy,'transactional-preferred');
})();

(function nullableColumnAdditionPostgres(){
  var left=snapshot('postgresql','integer');
  var right=snapshot('postgresql','integer');
  right.tables[0].columns.push(column('users','nickname',3,'text',true));
  var plan=sql.planMigration(sql.diffSchemas(left,right));
  assert.strictEqual(plan.summary.steps,1);
  assert.strictEqual(plan.summary.automatic,1);
  assert.strictEqual(plan.executable,true);
  assert.ok(plan.steps[0].sql.indexOf('ALTER TABLE "public"."users" ADD COLUMN "nickname" TEXT')===0);
  assert.ok(plan.steps[0].rollback.sql.indexOf('DROP COLUMN "nickname"')!==-1);
})();

(function requiredColumnAdditionNeedsBackfill(){
  var left=snapshot('postgresql','integer');
  var right=snapshot('postgresql','integer');
  right.tables[0].columns.push(column('users','tenant_id',3,'integer',false));
  var plan=sql.planMigration(sql.diffSchemas(left,right));
  assert.strictEqual(plan.steps[0].safety,'manual-review');
  assert.strictEqual(plan.steps[0].execution,'manual');
  assert.strictEqual(plan.executable,false);
  assert.ok(plan.steps[0].preconditions.some(function(x){return /backfill/i.test(x);}));
})();

(function wideningPostgres(){
  var left=snapshot('postgresql','integer');
  var right=snapshot('postgresql','bigint');
  var plan=sql.planMigration(sql.diffSchemas(left,right));
  var step=plan.steps.find(function(entry){return entry.kind==='column'&&/id/.test(entry.logicalKey);});
  assert.ok(step);
  assert.strictEqual(step.execution,'automatic');
  assert.ok(step.sql.indexOf('ALTER COLUMN "id" TYPE BIGINT')!==-1);
})();

(function narrowingPostgres(){
  var left=snapshot('postgresql','bigint');
  var right=snapshot('postgresql','integer');
  var plan=sql.planMigration(sql.diffSchemas(left,right));
  var step=plan.steps.find(function(entry){return entry.kind==='column'&&/id/.test(entry.logicalKey);});
  assert.strictEqual(step.safety,'potentially-lossy');
  assert.ok(step.preconditions.some(function(x){return /fits the target/i.test(x);}));
})();

(function sqliteTypeChangeBecomesManual(){
  var left=snapshot('sqlite','INTEGER');
  var right=snapshot('sqlite','TEXT');
  var plan=sql.planMigration(sql.diffSchemas(left,right));
  var step=plan.steps.find(function(entry){return entry.kind==='column'&&/id/.test(entry.logicalKey);});
  assert.ok(step);
  assert.strictEqual(step.execution,'manual');
  assert.strictEqual(plan.executable,false);
})();

(function mysqlTransactionBoundary(){
  var left=snapshot('mysql','int');
  var right=snapshot('mysql','int');
  right.tables[0].columns.push(column('users','nickname',3,'text',true));
  var plan=sql.planMigration(sql.diffSchemas(left,right));
  assert.strictEqual(plan.transactionStrategy,'autocommit-boundary');
  assert.ok(plan.steps[0].sql.indexOf('ALTER TABLE `public`.`users` ADD COLUMN `nickname`')===0);
})();

(function destructiveDrop(){
  var left=snapshot('postgresql','integer');
  var right=snapshot('postgresql','integer');
  right.tables[0].columns=right.tables[0].columns.filter(function(entry){return entry.name!=='name';});
  var plan=sql.planMigration(sql.diffSchemas(left,right));
  var step=plan.steps[0];
  assert.strictEqual(step.safety,'destructive');
  assert.strictEqual(step.execution,'automatic');
  assert.strictEqual(step.rollback,null);
  assert.ok(/DROP COLUMN/.test(step.sql));
})();

(function foreignKeyOrderedAfterColumns(){
  var left=snapshot('postgresql','integer');
  left.tables.push({
    kind:'table',database:'app',schema:'public',name:'orders',native:{},
    columns:[column('orders','id',1,'integer',false),column('orders','user_id',2,'integer',false)],
    indexes:[],foreignKeys:[],constraints:[]
  });
  var right=JSON.parse(JSON.stringify(left));
  right.tables[1].foreignKeys.push({
    kind:'foreign-key',database:'app',schema:'public',table:'orders',name:'fk_orders_users',
    columns:['user_id'],referencedDatabase:'app',referencedSchema:'public',referencedTable:'users',
    referencedColumns:['id'],onUpdate:null,onDelete:'CASCADE',match:null,deferrable:null,initiallyDeferred:null,native:{}
  });
  var plan=sql.planMigration(sql.diffSchemas(left,right));
  var fk=plan.steps.find(function(step){return step.kind==='foreign-key';});
  assert.ok(fk);
  assert.strictEqual(fk.phase,80);
  assert.strictEqual(fk.execution,'automatic');
  assert.ok(/ADD CONSTRAINT/.test(fk.sql));
})();

(function helperFilters(){
  var left=snapshot('sqlite','INTEGER');
  var right=snapshot('sqlite','TEXT');
  var plan=sql.planMigration(sql.diffSchemas(left,right));
  assert.strictEqual(sql.migrationManualSteps(plan).length,1);
  assert.strictEqual(sql.migrationAutomaticSteps(plan).length,0);
})();

console.log('NuBloxSQL migration planner contract: PASS');
