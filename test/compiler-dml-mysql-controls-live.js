'use strict';

var assert=require('assert');
var nublox=require('..');

function config(){
  return {dialect:'mysql',host:process.env.MYSQL_HOST||'127.0.0.1',port:Number(process.env.MYSQL_PORT||3306),user:process.env.MYSQL_USER,password:process.env.MYSQL_PASSWORD,database:process.env.MYSQL_DATABASE,ssl:'disable',getServerPublicKey:true,pool:{max:2}};
}

async function main(){
  if((process.env.NUBLOX_DIALECT||'mysql')!=='mysql'){
    console.log('NuBloxSQL Wave 6e live MySQL mutation controls: SKIP');
    return;
  }
  var db=nublox.createClient(config());
  var model=nublox.capabilityModel;
  var table='nublox_dml_v7_ledger';
  var aux='nublox_dml_v7_aux';
  try{
    await db.execute('DROP TABLE IF EXISTS '+aux);
    await db.execute('DROP TABLE IF EXISTS '+table);
    await db.execute('CREATE TABLE '+table+' (id INTEGER PRIMARY KEY, tenant_id INTEGER NOT NULL, amount INTEGER NOT NULL)');
    await db.execute('CREATE TABLE '+aux+' (id INTEGER PRIMARY KEY, value INTEGER NOT NULL)');
    await db.execute('INSERT INTO '+table+' (id, tenant_id, amount) VALUES (1, 10, 10), (2, 10, 20), (3, 10, 30)');
    await db.execute('INSERT INTO '+aux+' (id, value) VALUES (1, 100), (2, 200), (3, 300)');

    var update=model.transpileSql('mysql','mysql',
      'UPDATE LOW_PRIORITY IGNORE '+table+' AS l SET l.amount = l.amount + 5 WHERE l.tenant_id = 10 ORDER BY l.id DESC LIMIT 1');
    assert.strictEqual(update.scope,'dml-v7');
    assert.strictEqual(update.certified,true);
    await db.execute(update.sql);
    var rows=await db.all('SELECT id, amount FROM '+table+' ORDER BY id');
    assert.deepStrictEqual(rows.map(function(row){return [Number(row.id),Number(row.amount)];}),[[1,10],[2,20],[3,35]]);

    var multi=model.transpileSql('mysql','mysql',
      'UPDATE LOW_PRIORITY IGNORE '+table+' AS l JOIN '+aux+' AS a ON a.id = l.id SET l.amount = a.value WHERE l.id = 1');
    assert.strictEqual(multi.scope,'dml-v7');
    await db.execute(multi.sql);
    assert.strictEqual(Number((await db.one('SELECT amount FROM '+table+' WHERE id=1')).amount),100);

    var del=model.transpileSql('mysql','mysql',
      'DELETE LOW_PRIORITY QUICK IGNORE FROM '+table+' AS l WHERE l.tenant_id = 10 ORDER BY l.id ASC LIMIT 1');
    assert.strictEqual(del.scope,'dml-v7');
    await db.execute(del.sql);
    var remaining=await db.all('SELECT id FROM '+table+' ORDER BY id');
    assert.deepStrictEqual(remaining.map(function(row){return Number(row.id);}),[2,3]);
  }finally{
    try{await db.execute('DROP TABLE IF EXISTS '+aux);}catch(_){}
    try{await db.execute('DROP TABLE IF EXISTS '+table);}catch(_){}
    await db.close();
  }
  console.log('NuBloxSQL Wave 6e live MySQL mutation controls: PASS');
}
main().catch(function(error){console.error(error&&error.stack?error.stack:error);process.exitCode=1;});
