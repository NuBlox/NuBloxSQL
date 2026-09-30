'use strict';

var assert=require('assert');
var nubloxsql=require('../../../..');

async function main(){
  var password=process.env.MSSQL_SA_PASSWORD;
  if(!password)throw new Error('MSSQL_SA_PASSWORD is required');
  var db=nubloxsql.createClient({
    dialect:'sqlserver',
    tdsVersion:'7.4',
    host:process.env.MSSQL_HOST||'127.0.0.1',
    port:Number(process.env.MSSQL_PORT||1433),
    user:'sa',password:password,database:'master',
    rejectUnauthorized:false,
    connectTimeout:10000,queryTimeout:15000,
    pool:{max:2}
  });
  try{
    var row=await db.one('SELECT CAST(74 AS int) AS transport_value');
    assert.deepStrictEqual(row,{transport_value:74});

    var parameterized=await db.one(nubloxsql.sql`SELECT CAST(${1234} AS bigint) AS bound_value`);
    assert.strictEqual(parameterized.bound_value,1234n);

    var exact='12345678901234567890.123456';
    var uuid='00112233-4455-6677-8899-aabbccddeeff';
    var typed=await db.one(nubloxsql.sql`
      SELECT
        ${nubloxsql.sql.typed(exact,{type:'decimal',precision:26,scale:6})} AS exact_decimal,
        ${nubloxsql.sql.typed(uuid,'uuid')} AS typed_uuid
    `);
    assert.strictEqual(typed.exact_decimal,exact);
    assert.strictEqual(typed.typed_uuid,uuid);

    var prepared=await db.prepare(nubloxsql.sql`
      SELECT
        ${nubloxsql.sql.parameter('amount',{type:'decimal',precision:26,scale:6})} AS exact_decimal,
        ${nubloxsql.sql.parameter('id','uuid')} AS typed_uuid
    `);
    var preparedRow=await prepared.one({amount:exact,id:uuid});
    assert.strictEqual(preparedRow.exact_decimal,exact);
    assert.strictEqual(preparedRow.typed_uuid,uuid);
    await prepared.close();

    var transactionValue=await db.transaction(async function(tx){
      var inside=await tx.one('SELECT CAST(1 AS int) AS in_transaction');
      return inside.in_transaction;
    },{isolationLevel:'read-committed'});
    assert.strictEqual(transactionValue,1);

    var streamed=[];
    for await(var streamRow of db.stream('SELECT CAST(1 AS int) AS id UNION ALL SELECT CAST(2 AS int) AS id ORDER BY id'))streamed.push(streamRow.id);
    assert.deepStrictEqual(streamed,[1,2]);

    console.log('NuBloxSQL live encrypted TDS 7.4 client + typed-bind contract passed');
  }finally{await db.close();}
}
main().catch(function(error){console.error(error.stack||error);process.exitCode=1;});
