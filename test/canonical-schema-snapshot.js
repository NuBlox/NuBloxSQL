'use strict';

var assert=require('assert');
var sql=require('..');

function snapshot(dialect,nativeType,reverse){
  var columns=[
    {kind:'column',database:'app',schema:'public',table:'users',name:'id',ordinal:1,dataType:nativeType,nativeType:nativeType,nullability:'not-null',default:null,primaryKey:true,identity:false,generated:{enabled:false,kind:null,expression:null},native:{}},
    {kind:'column',database:'app',schema:'public',table:'users',name:'name',ordinal:2,dataType:'text',nativeType:'text',nullability:'nullable',default:null,primaryKey:false,identity:false,generated:{enabled:false,kind:null,expression:null},native:{}}
  ];
  if(reverse) columns=columns.slice().reverse();
  return {
    vocabularyVersion:1,dialect:dialect,scope:{database:'app',schema:'public'},
    databases:[{kind:'database',name:'app',native:{}}],
    schemas:[{kind:'schema',database:'app',name:'public',native:{}}],
    tables:[{kind:'table',database:'app',schema:'public',name:'users',columns:columns,indexes:[],foreignKeys:[],constraints:[],native:{}}]
  };
}

(function deterministicContract(){
  var a=sql.buildSchemaSnapshot(snapshot('postgresql','integer',false));
  var b=sql.buildSchemaSnapshot(snapshot('postgresql','integer',true));
  assert.strictEqual(sql.SCHEMA_SNAPSHOT_SCHEMA_VERSION,1);
  assert.strictEqual(a.semanticHash,b.semanticHash);
  assert.strictEqual(a.sourceHash,b.sourceHash);
  assert.strictEqual(sql.schemasEquivalent(a,b),true);
  assert.strictEqual(sql.sourceSchemasEquivalent(a,b),true);
  assert.strictEqual(sql.schemaFingerprint(a),a.semanticHash);
  assert.ok(Object.isFrozen(a));
})();

(function crossDialectSemanticContract(){
  var pg=sql.buildSchemaSnapshot(snapshot('postgresql','integer',false));
  var my=sql.buildSchemaSnapshot(snapshot('mysql','int',false));
  assert.strictEqual(pg.tables[0].columns[0].canonicalType.family,'int32');
  assert.strictEqual(my.tables[0].columns[0].canonicalType.family,'int32');
  assert.strictEqual(pg.semanticHash,my.semanticHash);
  assert.notStrictEqual(pg.sourceHash,my.sourceHash);
  assert.strictEqual(sql.schemasEquivalent(pg,my),true);
  assert.strictEqual(sql.sourceSchemasEquivalent(pg,my),false);
})();

(function semanticChangeContract(){
  var a=sql.buildSchemaSnapshot(snapshot('postgresql','integer',false));
  var b=sql.buildSchemaSnapshot(snapshot('postgresql','bigint',false));
  assert.notStrictEqual(a.semanticHash,b.semanticHash);
  assert.strictEqual(sql.schemasEquivalent(a,b),false);
})();

(function logicalKeyContract(){
  var key=sql.schemaLogicalKey('column',{database:'app',schema:'public',table:'users',name:'id'});
  assert.strictEqual(typeof key,'string');
  assert.ok(key.indexOf('column/')===0);
  assert.strictEqual(key.indexOf('postgresql'),-1);
})();

async function live(){
  var db=sql.createClient({dialect:'sqlite',filename:':memory:'});
  try{
    await db.execute('CREATE TABLE parent (id INTEGER PRIMARY KEY)');
    await db.execute('CREATE TABLE child (id INTEGER PRIMARY KEY, parent_id INTEGER REFERENCES parent(id))');
    var snap=await db.schemaSnapshot({database:'main',schema:'main',deep:true});
    assert.strictEqual(snap.sourceDialect,'sqlite');
    assert.ok(snap.tables.some(function(t){return t.name==='parent';}));
    assert.ok(snap.dependencies.some(function(e){return e.relation==='references';}));
    assert.strictEqual(await db.catalog.schemaSnapshot({database:'main',schema:'main',deep:true}).then(function(x){return x.semanticHash;}),snap.semanticHash);
  }finally{await db.close();}
}

live().then(function(){console.log('NuBloxSQL canonical schema snapshot contract: PASS');}).catch(function(error){console.error(error&&error.stack?error.stack:error);process.exitCode=1;});
