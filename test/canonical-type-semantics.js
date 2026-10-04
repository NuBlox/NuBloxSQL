'use strict';

var assert=require('assert');
var sql=require('..');

assert.strictEqual(sql.TYPE_SEMANTICS_SCHEMA_VERSION,1);
assert.ok(sql.TYPE_MAPPING_DECISIONS.indexOf('native-equivalent')!==-1);
assert.ok(sql.TYPE_MAPPING_DECISIONS.indexOf('lossless-map')!==-1);
assert.ok(sql.TYPE_MAPPING_DECISIONS.indexOf('lossy-map')!==-1);
assert.ok(sql.TYPE_MAPPING_DECISIONS.indexOf('application-convention')!==-1);
assert.ok(sql.TYPE_MAPPING_DECISIONS.indexOf('unsupported')!==-1);
assert.ok(sql.TYPE_MAPPING_DECISIONS.indexOf('runtime-qualified')!==-1);

(function inferenceContract(){
  var pgDecimal=sql.canonicalType('postgresql','numeric(26,6)');
  assert.strictEqual(pgDecimal.family,'decimal');
  assert.strictEqual(pgDecimal.precision,26);
  assert.strictEqual(pgDecimal.scale,6);

  var pgTz=sql.canonicalType('postgresql','timestamp(6) with time zone');
  assert.strictEqual(pgTz.family,'timestamp');
  assert.strictEqual(pgTz.timezone,true);
  assert.strictEqual(pgTz.scale,6);

  var myUnsigned=sql.canonicalType('mysql','bigint unsigned');
  assert.strictEqual(myUnsigned.family,'int64');
  assert.strictEqual(myUnsigned.unsigned,true);

  var sqliteText=sql.canonicalType('sqlite','VARCHAR(100)');
  assert.strictEqual(sqliteText.family,'text');

  var ssGuid=sql.canonicalType('sqlserver','uniqueidentifier');
  assert.strictEqual(ssGuid.family,'uuid');

  var ssOffset=sql.canonicalType('sqlserver','datetimeoffset(7)');
  assert.strictEqual(ssOffset.family,'timestamp');
  assert.strictEqual(ssOffset.timezone,true);
  assert.strictEqual(ssOffset.scale,7);

  var unknown=sql.canonicalType('postgresql','ltree');
  assert.strictEqual(unknown.family,'native');
  assert.strictEqual(unknown.native,'ltree');
})();

(function portableBindBridge(){
  var decimal=sql.canonicalTypeFromPortableSpec({type:'decimal',precision:26,scale:6});
  assert.deepStrictEqual(
    {family:decimal.family,precision:decimal.precision,scale:decimal.scale},
    {family:'decimal',precision:26,scale:6}
  );
  var uuid=sql.typeSemantics.fromPortableSpec('uuid');
  assert.strictEqual(uuid.family,'uuid');
  var timestamp=sql.typeSemantics.fromPortableSpec({type:'timestamp',scale:6});
  assert.strictEqual(timestamp.family,'timestamp');
  assert.strictEqual(timestamp.scale,6);
})();

(function targetMappingContract(){
  var unsigned64=sql.typeSemantics.canonical('int64',{unsigned:true});
  var pgUnsigned=sql.nativeTypeMapping('postgresql',unsigned64);
  assert.strictEqual(pgUnsigned.decision,'lossless-map');
  assert.strictEqual(pgUnsigned.nativeType,'NUMERIC(20,0)');
  assert.strictEqual(pgUnsigned.lossless,true);

  var mysqlUuid=sql.nativeTypeMapping('mysql',sql.typeSemantics.canonical('uuid'));
  assert.strictEqual(mysqlUuid.decision,'application-convention');
  assert.strictEqual(mysqlUuid.nativeType,'CHAR(36)');

  var mysqlTz=sql.nativeTypeMapping('mysql',sql.typeSemantics.canonical('timestamp',{scale:6,timezone:true}));
  assert.strictEqual(mysqlTz.decision,'lossy-map');
  assert.strictEqual(mysqlTz.lossless,false);

  var sqliteDecimal=sql.nativeTypeMapping('sqlite',sql.typeSemantics.canonical('decimal',{precision:38,scale:10}));
  assert.strictEqual(sqliteDecimal.decision,'application-convention');
  assert.strictEqual(sqliteDecimal.nativeType,'TEXT');

  var sqlServerJson=sql.nativeTypeMapping('sqlserver',sql.typeSemantics.canonical('json'));
  assert.strictEqual(sqlServerJson.decision,'application-convention');
  assert.strictEqual(sqlServerJson.nativeType,'NVARCHAR(MAX)');

  var mysqlTooWide=sql.nativeTypeMapping('mysql',sql.typeSemantics.canonical('decimal',{precision:66,scale:2}));
  assert.strictEqual(mysqlTooWide.decision,'unsupported');

  var sqlServerTooWide=sql.nativeTypeMapping('sqlserver',sql.typeSemantics.canonical('decimal',{precision:39,scale:2}));
  assert.strictEqual(sqlServerTooWide.decision,'unsupported');

  var mysqlNanoseconds=sql.nativeTypeMapping('mysql',sql.typeSemantics.canonical('timestamp',{scale:9}));
  assert.strictEqual(mysqlNanoseconds.decision,'lossy-map');
  assert.strictEqual(mysqlNanoseconds.nativeType,'DATETIME(6)');

  var postgresNano=sql.nativeTypeMapping('postgresql',sql.typeSemantics.canonical('time',{scale:9}));
  assert.strictEqual(postgresNano.decision,'lossy-map');
  assert.strictEqual(postgresNano.nativeType,'TIME(6)');
})();

(function compatibilityContract(){
  var pgJsonToMysql=sql.typeCompatibility('postgresql','mysql','jsonb');
  assert.strictEqual(pgJsonToMysql.canonical.family,'json');
  assert.strictEqual(pgJsonToMysql.target.decision,'native-equivalent');
  assert.strictEqual(pgJsonToMysql.target.nativeType,'JSON');

  var mysqlUnsignedToSqlite=sql.typeCompatibility('mysql','sqlite','bigint unsigned');
  assert.strictEqual(mysqlUnsignedToSqlite.canonical.unsigned,true);
  assert.strictEqual(mysqlUnsignedToSqlite.target.decision,'lossy-map');
})();

(function annotationContract(){
  var snapshot={
    vocabularyVersion:1,
    dialect:'postgresql',
    scope:{database:'app',schema:'public'},
    databases:[{kind:'database',name:'app',native:{}}],
    schemas:[{kind:'schema',database:'app',name:'public',native:{}}],
    tables:[{
      kind:'table',database:'app',schema:'public',name:'events',native:{},
      columns:[
        {kind:'column',database:'app',schema:'public',table:'events',name:'id',ordinal:1,dataType:'uuid',nativeType:'uuid',nullability:'not-null',default:null,primaryKey:true,identity:false,generated:{enabled:false,kind:null,expression:null},native:{}},
        {kind:'column',database:'app',schema:'public',table:'events',name:'payload',ordinal:2,dataType:'jsonb',nativeType:'jsonb',nullability:'nullable',default:null,primaryKey:false,identity:false,generated:{enabled:false,kind:null,expression:null},native:{}}
      ],
      indexes:[],foreignKeys:[],constraints:[]
    }]
  };
  var annotation=sql.annotateTypes(snapshot);
  assert.strictEqual(annotation.dialect,'postgresql');
  assert.strictEqual(annotation.tables[0].columns[0].canonical.family,'uuid');
  assert.strictEqual(annotation.tables[0].columns[1].canonical.family,'json');
  assert.ok(Object.isFrozen(annotation));
})();

async function liveSqliteContract(){
  var db=sql.createClient({dialect:'sqlite',filename:':memory:'});
  try{
    await db.execute('CREATE TABLE type_semantics (id INTEGER PRIMARY KEY, amount DECIMAL(20,4), payload TEXT, created_at TEXT)');
    var snapshot=await db.introspect({database:'main',schema:'main',deep:true});
    var annotation=sql.annotateTypes(snapshot);
    var table=annotation.tables.find(function(entry){return entry.name==='type_semantics';});
    assert.ok(table);
    var id=table.columns.find(function(entry){return entry.name==='id';});
    assert.strictEqual(id.canonical.family,'int64');
    var amount=table.columns.find(function(entry){return entry.name==='amount';});
    assert.strictEqual(amount.canonical.family,'decimal');
  }finally{
    await db.close();
  }
}

liveSqliteContract().then(function(){
  console.log('NuBloxSQL canonical type semantics contract: PASS');
}).catch(function(error){
  console.error(error&&error.stack?error.stack:error);
  process.exitCode=1;
});
