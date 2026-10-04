'use strict';

var assert=require('assert');
var nublox=require('..');

function configFor(dialect){
  if(dialect==='postgresql')return {dialect:'postgresql',host:process.env.PGHOST||'127.0.0.1',port:Number(process.env.PGPORT||5432),user:process.env.PGUSER,password:process.env.PGPASSWORD,database:process.env.PGDATABASE,pool:{max:2}};
  if(dialect==='mysql')return {dialect:'mysql',host:process.env.MYSQL_HOST||'127.0.0.1',port:Number(process.env.MYSQL_PORT||3306),user:process.env.MYSQL_USER,password:process.env.MYSQL_PASSWORD,database:process.env.MYSQL_DATABASE,ssl:'disable',getServerPublicKey:true,pool:{max:2}};
  if(dialect==='sqlite')return {dialect:'sqlite',filename:':memory:',pool:false};
  throw new Error('Unsupported dml-v3 live dialect: '+dialect);
}

async function main(){
  var dialect=process.env.NUBLOX_DIALECT||'sqlite';
  var db=nublox.createClient(configFor(dialect));
  var model=nublox.capabilityModel;
  var target='nublox_dml_v3_target';
  var source='nublox_dml_v3_source';
  try{
    await db.execute('DROP TABLE IF EXISTS '+target);
    await db.execute('DROP TABLE IF EXISTS '+source);
    await db.execute('CREATE TABLE '+target+' (id INTEGER PRIMARY KEY, value INTEGER NOT NULL)');
    await db.execute('CREATE TABLE '+source+' (id INTEGER PRIMARY KEY, value INTEGER NOT NULL, remove_flag INTEGER NOT NULL)');
    await db.execute('INSERT INTO '+target+' (id, value) VALUES (1, 10), (2, 20)');
    await db.execute('INSERT INTO '+source+' (id, value, remove_flag) VALUES (1, 100, 0), (2, 200, 1)');
    var q=await model.qualifyClient(db);

    if(dialect==='mysql'){
      assert.throws(function(){
        model.parseSql('mysql','UPDATE '+target+' SET value = src.value FROM '+source+' AS src WHERE '+target+'.id = src.id');
      },/distinct semantic family/);
      assert.strictEqual(model.status('mysql','syntax.multiTableUpdate').support,'native');
      assert.strictEqual(model.status('mysql','syntax.updateFrom').support,'unsupported');
    }else{
      var update=model.transpileSql(dialect,dialect,
        'UPDATE '+target+' SET value = src.value FROM '+source+' AS src WHERE '+target+'.id = src.id',
        {sourceQualification:q,targetQualification:q});
      assert.strictEqual(update.scope,'dml-v3');
      assert.strictEqual(update.certified,true);
      await db.execute(update.sql);
      var one=await db.one('SELECT value FROM '+target+' WHERE id = 1');
      var two=await db.one('SELECT value FROM '+target+' WHERE id = 2');
      assert.strictEqual(Number(one.value),100);
      assert.strictEqual(Number(two.value),200);

      if(dialect==='postgresql'){
        var del=model.transpileSql('postgresql','postgresql',
          'DELETE FROM '+target+' USING '+source+' AS src WHERE '+target+'.id = src.id AND src.remove_flag = 1 RETURNING '+target+'.id',
          {sourceQualification:q,targetQualification:q});
        assert.strictEqual(del.scope,'dml-v3');
        assert.strictEqual(del.certified,true);
        var removed=await db.one(del.sql);
        assert.strictEqual(Number(removed.id),2);
      }else{
        assert.throws(function(){
          model.parseSql('sqlite','DELETE FROM '+target+' USING '+source+' AS src WHERE '+target+'.id = src.id');
        },/PostgreSQL source syntax/);
      }
    }
  }finally{
    try{await db.execute('DROP TABLE IF EXISTS '+target);}catch(_){}
    try{await db.execute('DROP TABLE IF EXISTS '+source);}catch(_){}
    await db.close();
  }
  console.log('NuBloxSQL Wave 6a live advanced DML qualification: PASS for '+dialect);
}
main().catch(function(error){console.error(error&&error.stack?error.stack:error);process.exitCode=1;});
