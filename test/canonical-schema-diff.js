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

function baseSnapshot(dialect,idType){
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

(function equivalentAcrossDialects(){
  var pg=sql.buildSchemaSnapshot(baseSnapshot('postgresql','integer'));
  var my=sql.buildSchemaSnapshot(baseSnapshot('mysql','int'));
  var diff=sql.diffSchemas(pg,my);
  assert.strictEqual(sql.SCHEMA_DIFF_SCHEMA_VERSION,1);
  assert.strictEqual(diff.equivalent,true);
  assert.strictEqual(diff.summary.added,0);
  assert.strictEqual(diff.summary.removed,0);
  assert.strictEqual(diff.summary.modified,0);
  assert.strictEqual(sql.schemaDiffChanged(diff),false);
  assert.strictEqual(sql.schemaDiffHighestSafety(diff),'safe');
})();

(function addedObjects(){
  var left=baseSnapshot('postgresql','integer');
  var right=baseSnapshot('postgresql','integer');
  right.tables[0].columns.push(column('users','nickname',3,'text',true));
  var diff=sql.diffSchemas(left,right);
  var change=diff.changes.find(function(entry){return entry.after&&entry.after.name==='nickname';});
  assert.ok(change);
  assert.strictEqual(change.status,'added');
  assert.strictEqual(change.safety,'safe');
})();

(function requiredColumnNeedsReview(){
  var left=baseSnapshot('postgresql','integer');
  var right=baseSnapshot('postgresql','integer');
  right.tables[0].columns.push(column('users','tenant_id',3,'integer',false));
  var diff=sql.diffSchemas(left,right);
  var change=diff.changes.find(function(entry){return entry.after&&entry.after.name==='tenant_id';});
  assert.strictEqual(change.safety,'manual-review');
})();

(function removedIsDestructive(){
  var left=baseSnapshot('postgresql','integer');
  var right=baseSnapshot('postgresql','integer');
  right.tables[0].columns=right.tables[0].columns.filter(function(entry){return entry.name!=='name';});
  var diff=sql.diffSchemas(left,right);
  var change=diff.changes.find(function(entry){return entry.before&&entry.before.name==='name';});
  assert.strictEqual(change.status,'removed');
  assert.strictEqual(change.safety,'destructive');
  assert.strictEqual(sql.schemaDiffHighestSafety(diff),'destructive');
})();

(function wideningAndNarrowing(){
  var left=baseSnapshot('postgresql','integer');
  var wider=baseSnapshot('postgresql','bigint');
  var wideDiff=sql.diffSchemas(left,wider);
  var wide=wideDiff.changes.find(function(entry){return entry.kind==='column'&&entry.before.name==='id';});
  assert.strictEqual(wide.status,'modified');
  assert.strictEqual(wide.safety,'safe');
  assert.ok(wide.deltas.some(function(delta){return delta.property==='canonicalType';}));

  var narrowDiff=sql.diffSchemas(wider,left);
  var narrow=narrowDiff.changes.find(function(entry){return entry.kind==='column'&&entry.before.name==='id';});
  assert.strictEqual(narrow.safety,'potentially-lossy');
})();

(function nullabilityTightening(){
  var left=baseSnapshot('postgresql','integer');
  var right=baseSnapshot('postgresql','integer');
  right.tables[0].columns[1].nullability='not-null';
  var diff=sql.diffSchemas(left,right);
  var change=diff.changes.find(function(entry){return entry.kind==='column'&&entry.before.name==='name';});
  assert.strictEqual(change.safety,'manual-review');
})();

(function foreignKeyDependencies(){
  var left=baseSnapshot('sqlite','INTEGER');
  left.tables.push({
    kind:'table',database:'app',schema:'public',name:'orders',native:{},
    columns:[column('orders','id',1,'INTEGER',false),column('orders','user_id',2,'INTEGER',false)],
    indexes:[],foreignKeys:[],constraints:[]
  });

  var right=JSON.parse(JSON.stringify(left));
  right.tables[1].foreignKeys.push({
    kind:'foreign-key',database:'app',schema:'public',table:'orders',name:'fk_orders_users',
    columns:['user_id'],referencedDatabase:'app',referencedSchema:'public',referencedTable:'users',
    referencedColumns:['id'],onUpdate:null,onDelete:'CASCADE',match:null,deferrable:null,initiallyDeferred:null,native:{}
  });

  var diff=sql.diffSchemas(left,right);
  var fk=diff.changes.find(function(entry){return entry.kind==='foreign-key';});
  assert.ok(fk);
  assert.strictEqual(fk.status,'added');
  assert.strictEqual(fk.safety,'dependency-sensitive');
  assert.ok(diff.dependencyChanges.added.length>0);
})();

(function defaultChangeNeedsReview(){
  var left=baseSnapshot('postgresql','integer');
  var right=baseSnapshot('postgresql','integer');
  right.tables[0].columns[1].default="'anonymous'";
  var diff=sql.diffSchemas(left,right);
  var change=diff.changes.find(function(entry){return entry.kind==='column'&&entry.before.name==='name';});
  assert.strictEqual(change.safety,'manual-review');
})();

console.log('NuBloxSQL canonical schema diff contract: PASS');
