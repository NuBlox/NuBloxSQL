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
    console.log('NuBloxSQL dml-v10 live MERGE rich-source qualification: SKIP');
    return;
  }

  var db=nublox.createClient(config());
  var model=nublox.capabilityModel;
  var target='nublox_dml_v10_target';
  var incoming='nublox_dml_v10_incoming';
  var tenants='nublox_dml_v10_tenants';

  try{
    await db.execute('DROP TABLE IF EXISTS '+incoming);
    await db.execute('DROP TABLE IF EXISTS '+tenants);
    await db.execute('DROP TABLE IF EXISTS '+target);

    await db.execute('CREATE TABLE '+target+' (id INTEGER PRIMARY KEY, amount INTEGER NOT NULL)');
    await db.execute('CREATE TABLE '+incoming+' (id INTEGER PRIMARY KEY, tenant_id INTEGER NOT NULL, amount INTEGER NOT NULL)');
    await db.execute('CREATE TABLE '+tenants+' (id INTEGER PRIMARY KEY, enabled BOOLEAN NOT NULL)');

    await db.execute('INSERT INTO '+target+' (id, amount) VALUES (1, 10), (2, 20)');
    await db.execute('INSERT INTO '+incoming+' (id, tenant_id, amount) VALUES (1, 10, 100), (2, 20, 200), (3, 10, 300)');
    await db.execute('INSERT INTO '+tenants+' (id, enabled) VALUES (10, TRUE), (20, FALSE)');

    var statement=[
      'MERGE INTO '+target+' AS t',
      'USING (WITH enabled_tenants AS (SELECT id FROM '+tenants+' WHERE enabled = TRUE)',
      'SELECT i.id, i.amount FROM '+incoming+' AS i',
      'INNER JOIN enabled_tenants AS e ON e.id = i.tenant_id) AS s',
      'ON t.id = s.id',
      'WHEN MATCHED THEN UPDATE SET amount = s.amount',
      'WHEN NOT MATCHED THEN INSERT (id, amount) VALUES (s.id, s.amount)'
    ].join(' ');

    var result=model.transpileSql('postgresql','postgresql',statement);
    assert.strictEqual(result.scope,'dml-v10');
    assert.strictEqual(result.certified,true);
    await db.execute(result.sql);

    var rows=await db.all('SELECT id, amount FROM '+target+' ORDER BY id');
    assert.deepStrictEqual(rows.map(function(row){return [Number(row.id),Number(row.amount)];}),[[1,100],[2,20],[3,300]]);
  }finally{
    try{await db.execute('DROP TABLE IF EXISTS '+incoming);}catch(_){}
    try{await db.execute('DROP TABLE IF EXISTS '+tenants);}catch(_){}
    try{await db.execute('DROP TABLE IF EXISTS '+target);}catch(_){}
    await db.close();
  }

  console.log('NuBloxSQL dml-v10 live MERGE rich-source qualification: PASS');
}

main().catch(function(error){console.error(error&&error.stack?error.stack:error);process.exitCode=1;});
