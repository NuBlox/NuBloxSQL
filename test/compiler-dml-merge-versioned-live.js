'use strict';

var assert=require('assert');
var nublox=require('..');

function config(){
  return {
    dialect:'postgresql',
    host:process.env.PGHOST||'127.0.0.1',
    port:Number(process.env.PGPORT||5432),
    user:process.env.PGUSER,
    password:process.env.PGPASSWORD,
    database:process.env.PGDATABASE,
    pool:{max:2}
  };
}

function major(version){
  var m=String(version||'').match(/^(\d+)/);
  return m?Number(m[1]):0;
}

async function main(){
  if((process.env.NUBLOX_DIALECT||'postgresql')!=='postgresql'){
    console.log('NuBloxSQL dml-v9 live MERGE qualification: SKIP');
    return;
  }

  var db=nublox.createClient(config());
  var model=nublox.capabilityModel;
  var target='nublox_dml_v9_target',source='nublox_dml_v9_source';

  try{
    var q=await model.qualifyClient(db);
    var version=major(q.version);
    var statement=[
      'MERGE INTO '+target+' AS t USING '+source+' AS s ON t.id = s.id',
      'WHEN MATCHED THEN UPDATE SET amount = s.amount',
      'WHEN NOT MATCHED BY TARGET THEN INSERT (id, amount) VALUES (s.id, s.amount)',
      'WHEN NOT MATCHED BY SOURCE THEN DELETE',
      'RETURNING merge_action(), t.id, t.amount'
    ].join(' ');

    if(version<17){
      assert.throws(function(){
        model.transpileSql('postgresql','postgresql',statement,{sourceQualification:q,targetQualification:q});
      },/blocked by unsupported capabilities/);
      console.log('NuBloxSQL dml-v9 PostgreSQL '+version+' negative qualification: PASS');
      return;
    }

    await db.execute('DROP TABLE IF EXISTS '+source);
    await db.execute('DROP TABLE IF EXISTS '+target);
    await db.execute('CREATE TABLE '+target+' (id INTEGER PRIMARY KEY, amount INTEGER NOT NULL)');
    await db.execute('CREATE TABLE '+source+' (id INTEGER PRIMARY KEY, amount INTEGER NOT NULL)');
    await db.execute('INSERT INTO '+target+' (id, amount) VALUES (1, 10), (2, 20)');
    await db.execute('INSERT INTO '+source+' (id, amount) VALUES (1, 100), (3, 300)');

    var result=model.transpileSql('postgresql','postgresql',statement,{sourceQualification:q,targetQualification:q});
    assert.strictEqual(result.scope,'dml-v9');
    assert.strictEqual(result.certified,true);

    var returned=await db.all(result.sql);
    var normalized=returned.map(function(row){
      return [String(row.merge_action),Number(row.id),Number(row.amount)];
    }).sort(function(a,b){return a[1]-b[1];});
    assert.deepStrictEqual(normalized,[['UPDATE',1,100],['DELETE',2,20],['INSERT',3,300]]);

    var rows=await db.all('SELECT id, amount FROM '+target+' ORDER BY id');
    assert.deepStrictEqual(rows.map(function(row){return [Number(row.id),Number(row.amount)];}),[[1,100],[3,300]]);
  }finally{
    try{await db.execute('DROP TABLE IF EXISTS '+source);}catch(_){}
    try{await db.execute('DROP TABLE IF EXISTS '+target);}catch(_){}
    await db.close();
  }

  console.log('NuBloxSQL dml-v9 live PostgreSQL MERGE qualification: PASS');
}

main().catch(function(error){console.error(error&&error.stack?error.stack:error);process.exitCode=1;});
