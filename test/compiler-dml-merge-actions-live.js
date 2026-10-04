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

async function main(){
  if((process.env.NUBLOX_DIALECT||'postgresql')!=='postgresql'){
    console.log('NuBloxSQL live MERGE action-chain qualification: SKIP');
    return;
  }
  var db=nublox.createClient(config());
  var model=nublox.capabilityModel;
  var target='nublox_dml_v8_target',source='nublox_dml_v8_source';
  try{
    await db.execute('DROP TABLE IF EXISTS '+source);
    await db.execute('DROP TABLE IF EXISTS '+target);
    await db.execute('CREATE TABLE '+target+' (id INTEGER PRIMARY KEY, amount INTEGER NOT NULL)');
    await db.execute('CREATE TABLE '+source+' (id INTEGER PRIMARY KEY, amount INTEGER NOT NULL)');
    await db.execute('INSERT INTO '+target+' (id, amount) VALUES (1, 10), (2, 20)');
    await db.execute('INSERT INTO '+source+' (id, amount) VALUES (1, 100), (2, 0), (3, 300), (4, 0)');
    var q=await model.qualifyClient(db);

    var merge=[
      'MERGE INTO '+target+' AS t USING '+source+' AS s ON t.id = s.id',
      'WHEN MATCHED AND s.amount > 0 THEN UPDATE SET amount = s.amount',
      'WHEN MATCHED THEN DELETE',
      'WHEN NOT MATCHED AND s.amount > 0 THEN INSERT (id, amount) VALUES (s.id, s.amount)',
      'WHEN NOT MATCHED THEN DO NOTHING'
    ].join(' ');
    var compiled=model.transpileSql('postgresql','postgresql',merge,{sourceQualification:q,targetQualification:q});
    assert.strictEqual(compiled.scope,'dml-v8');
    assert.strictEqual(compiled.certified,true);
    await db.execute(compiled.sql);

    var rows=await db.all('SELECT id, amount FROM '+target+' ORDER BY id');
    assert.deepStrictEqual(rows.map(function(row){return [Number(row.id),Number(row.amount)];}),[[1,100],[3,300]]);
  }finally{
    try{await db.execute('DROP TABLE IF EXISTS '+source);}catch(_){}
    try{await db.execute('DROP TABLE IF EXISTS '+target);}catch(_){}
    await db.close();
  }
  console.log('NuBloxSQL live MERGE action-chain qualification: PASS');
}
main().catch(function(error){console.error(error&&error.stack?error.stack:error);process.exitCode=1;});
