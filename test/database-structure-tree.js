'use strict';

var assert=require('assert');
var nublox=require('..');

function portableSample(){
  return {
    vocabularyVersion:1,
    dialect:'sqlite',
    scope:{database:'main',schema:'main'},
    databases:[{kind:'database',name:'main',native:{}}],
    schemas:[{kind:'schema',database:'main',name:'main',native:{}}],
    tables:[
      {
        kind:'table',database:'main',schema:'main',name:'users',native:{},
        columns:[
          {kind:'column',database:'main',schema:'main',table:'users',name:'id',ordinal:1,dataType:'integer',nativeType:'INTEGER',nullability:'not-null',default:null,primaryKey:true,identity:true,generated:{enabled:false,kind:null,expression:null},native:{}},
          {kind:'column',database:'main',schema:'main',table:'users',name:'email',ordinal:2,dataType:'text',nativeType:'TEXT',nullability:'not-null',default:null,primaryKey:false,identity:false,generated:{enabled:false,kind:null,expression:null},native:{}}
        ],
        indexes:[
          {kind:'index',database:'main',schema:'main',table:'users',name:'ux_users_email',unique:true,primary:false,method:'btree',predicate:null,keyParts:[{ordinal:1,column:'email',expression:null,descending:false,collation:null,included:false}],native:{}}
        ],
        foreignKeys:[],
        constraints:[
          {kind:'constraint',database:'main',schema:'main',table:'users',name:'pk_users',type:'primary-key',columns:['id'],definition:'PRIMARY KEY (id)',deferrable:null,initiallyDeferred:null,native:{}}
        ]
      },
      {
        kind:'view',database:'main',schema:'main',name:'active_users',native:{},
        columns:[],indexes:[],foreignKeys:[],constraints:[]
      }
    ]
  };
}

(function pureBuilderContract(){
  var tree=nublox.buildStructureTree(portableSample());
  assert.strictEqual(nublox.STRUCTURE_TREE_SCHEMA_VERSION,1);
  assert.strictEqual(tree.schemaVersion,1);
  assert.strictEqual(tree.dialect,'sqlite');
  assert.deepStrictEqual(tree.summary,{
    databases:1,schemas:1,tables:1,views:1,foreignTables:0,
    columns:2,indexes:1,foreignKeys:0,constraints:1
  });
  assert.strictEqual(tree.databases[0].kind,'database');
  assert.strictEqual(tree.databases[0].children[0].kind,'schema');
  var users=tree.databases[0].children[0].children.find(function(entry){return entry.name==='users';});
  assert.ok(users);
  assert.strictEqual(users.kind,'table');
  assert.deepStrictEqual(users.children.map(function(entry){return entry.kind;}),['column','column','index','constraint']);
  assert.deepStrictEqual(users.children[0].path,['main','main','users','id']);
  assert.ok(Object.isFrozen(tree));
  assert.ok(Object.isFrozen(users.children));
})();

(function filteringContract(){
  var tree=nublox.buildStructureTree(portableSample(),{indexes:false,constraints:false});
  var users=tree.databases[0].children[0].children.find(function(entry){return entry.name==='users';});
  assert.strictEqual(users.children.some(function(entry){return entry.kind==='index';}),false);
  assert.strictEqual(users.children.some(function(entry){return entry.kind==='constraint';}),false);
  assert.strictEqual(tree.summary.indexes,0);
  assert.strictEqual(tree.summary.constraints,0);
})();

async function liveClientContract(){
  var db=nublox.createClient({dialect:'sqlite',filename:':memory:'});
  try{
    await db.execute('CREATE TABLE parent (id INTEGER PRIMARY KEY, name TEXT NOT NULL)');
    await db.execute('CREATE TABLE child (id INTEGER PRIMARY KEY, parent_id INTEGER NOT NULL REFERENCES parent(id), label TEXT UNIQUE)');
    await db.execute('CREATE VIEW child_view AS SELECT id, label FROM child');

    var tree=await db.structureTree({database:'main',schema:'main',deep:true});
    assert.strictEqual(tree.dialect,'sqlite');
    assert.ok(tree.summary.tables>=2);
    assert.ok(tree.summary.views>=1);
    assert.ok(tree.summary.columns>=5);
    assert.ok(tree.summary.foreignKeys>=1);

    var catalogTree=await db.catalog.structureTree({database:'main',schema:'main',deep:true,tree:{indexes:false}});
    assert.strictEqual(catalogTree.summary.indexes,0);
  }finally{
    await db.close();
  }
}

liveClientContract().then(function(){
  console.log('NuBloxSQL database structure tree contract: PASS');
}).catch(function(error){
  console.error(error&&error.stack?error.stack:error);
  process.exitCode=1;
});
