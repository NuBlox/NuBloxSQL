'use strict';

var assert = require('assert');
var nublox = require('..');

function column(table, name, ordinal) {
  return {
    kind:'column', database:'main', schema:'main', table:table, name:name, ordinal:ordinal,
    dataType:'integer', nativeType:'INTEGER', nullability:'not-null', default:null,
    primaryKey:name==='id', identity:name==='id',
    generated:{enabled:false,kind:null,expression:null}, native:{}
  };
}

function sample(reverse) {
  var parent = {
    kind:'table', database:'main', schema:'main', name:'parent', native:{},
    columns:[column('parent','id',1)], indexes:[], foreignKeys:[], constraints:[]
  };
  var child = {
    kind:'table', database:'main', schema:'main', name:'child', native:{},
    columns:[column('child','id',1),column('child','parent_id',2)],
    indexes:[
      {kind:'index',database:'main',schema:'main',table:'child',name:'ix_child_parent',unique:false,primary:false,method:'btree',predicate:null,keyParts:[{ordinal:1,column:'parent_id',expression:null,descending:false,collation:null,included:false}],native:{}}
    ],
    foreignKeys:[
      {kind:'foreign-key',database:'main',schema:'main',table:'child',name:null,columns:['parent_id'],referencedDatabase:'main',referencedSchema:'main',referencedTable:'parent',referencedColumns:['id'],onUpdate:null,onDelete:'CASCADE',match:null,deferrable:null,initiallyDeferred:null,native:{}}
    ],
    constraints:[]
  };
  return {
    vocabularyVersion:1,dialect:'sqlite',scope:{database:'main',schema:'main'},
    databases:[{kind:'database',name:'main',native:{}}],
    schemas:[{kind:'schema',database:'main',name:'main',native:{}}],
    tables:reverse?[parent,child]:[child,parent]
  };
}

(function stableIdentityContract(){
  assert.strictEqual(nublox.OBJECT_IDENTITY_SCHEMA_VERSION,1);
  var a=nublox.objectId('table',{database:'main',schema:'main',name:'orders'},{dialect:'sqlite'});
  var b=nublox.objectId('table',{database:'main',schema:'main',name:'orders'},{dialect:'sqlite'});
  assert.strictEqual(a,b);
  assert.ok(a.indexOf('nubloxsql://sqlite/table/')===0);
  var parsed=nublox.parseObjectId(a);
  assert.strictEqual(parsed.dialect,'sqlite');
  assert.strictEqual(parsed.kind,'table');
  assert.strictEqual(parsed.database,'main');
  assert.strictEqual(parsed.schema,'main');
  assert.strictEqual(parsed.table,'orders');

  var unnamed=nublox.objectId('foreign-key',sample(false).tables[0].foreignKeys[0],{dialect:'sqlite'});
  assert.ok(unnamed.indexOf('fk%5Bparent_id%5D-%3Eparent%5Bid%5D')!==-1);
})();

(function graphContract(){
  assert.strictEqual(nublox.DEPENDENCY_GRAPH_SCHEMA_VERSION,1);
  var graph=nublox.buildDependencyGraph(sample(false));
  var reordered=nublox.buildDependencyGraph(sample(true));
  assert.deepStrictEqual(graph.nodes.map(function(n){return n.id;}),reordered.nodes.map(function(n){return n.id;}));
  assert.deepStrictEqual(graph.edges,reordered.edges);
  assert.ok(Object.isFrozen(graph));
  assert.ok(Object.isFrozen(graph.nodes));
  assert.ok(Object.isFrozen(graph.edges));

  var childId=nublox.objectId('table',{database:'main',schema:'main',name:'child'},{dialect:'sqlite'});
  var parentId=nublox.objectId('table',{database:'main',schema:'main',name:'parent'},{dialect:'sqlite'});
  var childParentColumnId=nublox.objectId('column',{database:'main',schema:'main',table:'child',name:'parent_id'},{dialect:'sqlite'});
  var parentIdColumnId=nublox.objectId('column',{database:'main',schema:'main',table:'parent',name:'id'},{dialect:'sqlite'});

  assert.ok(graph.edges.some(function(e){return e.from===childId&&e.to===parentId&&e.relation==='references';}));
  assert.ok(graph.edges.some(function(e){return e.from===childParentColumnId&&e.to===parentIdColumnId&&e.relation==='references-column';}));

  var direct=nublox.graphDependencies(graph,childId,{transitive:false,relations:['references']});
  assert.deepStrictEqual(direct.map(function(n){return n.id;}),[parentId]);

  var foreignKeyId=nublox.objectId('foreign-key',sample(false).tables[0].foreignKeys[0],{dialect:'sqlite'});
  var dependents=nublox.graphDependents(graph,parentId,{transitive:false,relations:['references']});
  var dependentIds=dependents.map(function(n){return n.id;});
  assert.ok(dependentIds.indexOf(childId)!==-1);
  assert.ok(dependentIds.indexOf(foreignKeyId)!==-1);

  var impact=nublox.impactAnalysis(graph,parentId,{relations:['references','references-column','defined-on','uses-column']});
  assert.strictEqual(impact.object.id,parentId);
  assert.ok(impact.dependents.some(function(n){return n.id===childId;}));
})();

(function structureTreeIdentityContract(){
  var tree=nublox.buildStructureTree(sample(false));
  assert.strictEqual(nublox.STRUCTURE_TREE_SCHEMA_VERSION,2);
  assert.strictEqual(tree.schemaVersion,2);
  var table=tree.databases[0].children[0].children.find(function(n){return n.name==='child';});
  assert.ok(table.id);
  assert.strictEqual(table.id,nublox.objectId('table',{database:'main',schema:'main',name:'child'},{dialect:'sqlite'}));
  assert.ok(table.children.every(function(n){return typeof n.id==='string'&&n.id.indexOf('nubloxsql://')===0;}));
})();

async function liveContract(){
  var db=nublox.createClient({dialect:'sqlite',filename:':memory:'});
  try{
    await db.execute('CREATE TABLE parent (id INTEGER PRIMARY KEY)');
    await db.execute('CREATE TABLE child (id INTEGER PRIMARY KEY, parent_id INTEGER NOT NULL REFERENCES parent(id))');
    var graph=await db.dependencyGraph({database:'main',schema:'main',deep:true});
    var parentId=nublox.objectId('table',{database:'main',schema:'main',name:'parent'},{dialect:'sqlite'});
    var childId=nublox.objectId('table',{database:'main',schema:'main',name:'child'},{dialect:'sqlite'});
    assert.ok(graph.edges.some(function(e){return e.from===childId&&e.to===parentId&&e.relation==='references';}));

    var catalogGraph=await db.catalog.dependencyGraph({database:'main',schema:'main',deep:true});
    assert.deepStrictEqual(catalogGraph.edges,graph.edges);
  }finally{
    await db.close();
  }
}

liveContract().then(function(){
  console.log('NuBloxSQL object identity and dependency graph contract: PASS');
}).catch(function(error){
  console.error(error&&error.stack?error.stack:error);
  process.exitCode=1;
});
