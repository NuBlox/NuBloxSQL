'use strict';

var assert=require('assert');
var nublox=require('..');

function configFor(dialect){
  if(dialect==='postgresql')return {dialect:'postgresql',host:process.env.PGHOST||'127.0.0.1',port:Number(process.env.PGPORT||5432),user:process.env.PGUSER,password:process.env.PGPASSWORD,database:process.env.PGDATABASE,pool:{max:2}};
  if(dialect==='mysql')return {dialect:'mysql',host:process.env.MYSQL_HOST||'127.0.0.1',port:Number(process.env.MYSQL_PORT||3306),user:process.env.MYSQL_USER,password:process.env.MYSQL_PASSWORD,database:process.env.MYSQL_DATABASE,ssl:'disable',getServerPublicKey:true,pool:{max:2}};
  if(dialect==='sqlite')return {dialect:'sqlite',filename:':memory:',pool:false};
  throw new Error('Unsupported dml-v4 live dialect: '+dialect);
}

async function main(){
  var dialect=process.env.NUBLOX_DIALECT||'sqlite';
  var db=nublox.createClient(configFor(dialect));
  var model=nublox.capabilityModel;
  var target='nublox_dml_v4_target',rates='nublox_dml_v4_rates',bands='nublox_dml_v4_bands';
  try{
    await db.execute('DROP TABLE IF EXISTS '+target);
    await db.execute('DROP TABLE IF EXISTS '+rates);
    await db.execute('DROP TABLE IF EXISTS '+bands);
    await db.execute('CREATE TABLE '+target+' (id INTEGER PRIMARY KEY, amount INTEGER NOT NULL)');
    await db.execute('CREATE TABLE '+rates+' (id INTEGER PRIMARY KEY, amount INTEGER NOT NULL, band_id INTEGER NOT NULL)');
    await db.execute('CREATE TABLE '+bands+' (id INTEGER PRIMARY KEY, enabled INTEGER NOT NULL)');
    await db.execute('INSERT INTO '+target+' (id, amount) VALUES (1, 10), (2, 20)');
    await db.execute('INSERT INTO '+rates+' (id, amount, band_id) VALUES (1, 100, 1), (2, 200, 2)');
    await db.execute('INSERT INTO '+bands+' (id, enabled) VALUES (1, 1), (2, 0)');
    var q=await model.qualifyClient(db);

    if(dialect==='mysql'){
      assert.throws(function(){
        model.parseSql('mysql','UPDATE '+target+' SET amount = r.amount FROM '+rates+' AS r INNER JOIN '+bands+' AS b ON b.id = r.band_id WHERE '+target+'.id = r.id');
      },/distinct semantic family/);
    }else{
      var update=model.transpileSql(dialect,dialect,
        'UPDATE '+target+' SET amount = r.amount FROM '+rates+' AS r INNER JOIN '+bands+' AS b ON b.id = r.band_id WHERE '+target+'.id = r.id AND b.enabled = 1',
        {sourceQualification:q,targetQualification:q});
      assert.strictEqual(update.scope,'dml-v4');
      assert.strictEqual(update.certified,true);
      await db.execute(update.sql);
      var one=await db.one('SELECT amount FROM '+target+' WHERE id = 1');
      var two=await db.one('SELECT amount FROM '+target+' WHERE id = 2');
      assert.strictEqual(Number(one.amount),100);
      assert.strictEqual(Number(two.amount),20);

      var derived=model.transpileSql(dialect,dialect,
        'UPDATE '+target+' SET amount = r.amount FROM (SELECT id, amount FROM '+rates+') AS r WHERE '+target+'.id = r.id',
        {sourceQualification:q,targetQualification:q});
      assert.strictEqual(derived.scope,'dml-v4');
      assert.strictEqual(derived.certified,true);
      await db.execute(derived.sql);

      if(dialect==='postgresql'){
        var del=model.transpileSql('postgresql','postgresql',
          'DELETE FROM '+target+' USING '+rates+' AS r INNER JOIN '+bands+' AS b ON b.id = r.band_id WHERE '+target+'.id = r.id AND b.enabled = 0',
          {sourceQualification:q,targetQualification:q});
        assert.strictEqual(del.scope,'dml-v4');
        assert.strictEqual(del.certified,true);
        await db.execute(del.sql);
        var remaining=await db.many('SELECT id FROM '+target+' ORDER BY id');
        assert.deepStrictEqual(remaining.map(function(row){return Number(row.id);}),[1]);
      }
    }
  }finally{
    try{await db.execute('DROP TABLE IF EXISTS '+target);}catch(_){}
    try{await db.execute('DROP TABLE IF EXISTS '+rates);}catch(_){}
    try{await db.execute('DROP TABLE IF EXISTS '+bands);}catch(_){}
    await db.close();
  }
  console.log('NuBloxSQL Wave 6b live rich DML source qualification: PASS for '+dialect);
}
main().catch(function(error){console.error(error&&error.stack?error.stack:error);process.exitCode=1;});
