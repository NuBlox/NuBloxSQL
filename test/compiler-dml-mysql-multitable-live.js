'use strict';

var assert=require('assert');
var nublox=require('..');

function config(){
  return {dialect:'mysql',host:process.env.MYSQL_HOST||'127.0.0.1',port:Number(process.env.MYSQL_PORT||3306),user:process.env.MYSQL_USER,password:process.env.MYSQL_PASSWORD,database:process.env.MYSQL_DATABASE,ssl:'disable',getServerPublicKey:true,pool:{max:2}};
}
async function main(){
  if((process.env.NUBLOX_DIALECT||'mysql')!=='mysql'){
    console.log('NuBloxSQL Wave 6d live MySQL multi-table qualification: SKIP');
    return;
  }
  var db=nublox.createClient(config());
  var model=nublox.capabilityModel;
  var a='nublox_dml_v6_accounts',b='nublox_dml_v6_balances';
  try{
    await db.execute('DROP TABLE IF EXISTS '+b);
    await db.execute('DROP TABLE IF EXISTS '+a);
    await db.execute('CREATE TABLE '+a+' (id INTEGER PRIMARY KEY, tenant_id INTEGER NOT NULL, status INTEGER NOT NULL)');
    await db.execute('CREATE TABLE '+b+' (account_id INTEGER PRIMARY KEY, amount INTEGER NOT NULL)');
    await db.execute('INSERT INTO '+a+' (id, tenant_id, status) VALUES (1, 10, 0), (2, 20, 0)');
    await db.execute('INSERT INTO '+b+' (account_id, amount) VALUES (1, 50), (2, 60)');

    var update=model.transpileSql('mysql','mysql',
      'UPDATE '+a+' AS a INNER JOIN '+b+' AS b ON b.account_id = a.id SET a.status = 1, b.amount = 99 WHERE a.tenant_id = 10');
    assert.strictEqual(update.scope,'dml-v6');
    assert.strictEqual(update.certified,true);
    await db.execute(update.sql);
    var ar=await db.one('SELECT status FROM '+a+' WHERE id = 1');
    var br=await db.one('SELECT amount FROM '+b+' WHERE account_id = 1');
    assert.strictEqual(Number(ar.status),1);
    assert.strictEqual(Number(br.amount),99);

    var del=model.transpileSql('mysql','mysql',
      'DELETE b FROM '+a+' AS a INNER JOIN '+b+' AS b ON b.account_id = a.id WHERE a.tenant_id = 10');
    assert.strictEqual(del.scope,'dml-v6');
    await db.execute(del.sql);
    var left=await db.all('SELECT account_id FROM '+b+' ORDER BY account_id');
    assert.deepStrictEqual(left.map(function(row){return Number(row.account_id);}),[2]);
  }finally{
    try{await db.execute('DROP TABLE IF EXISTS '+b);}catch(_){}
    try{await db.execute('DROP TABLE IF EXISTS '+a);}catch(_){}
    await db.close();
  }
  console.log('NuBloxSQL Wave 6d live MySQL multi-table qualification: PASS');
}
main().catch(function(error){console.error(error&&error.stack?error.stack:error);process.exitCode=1;});
