'use strict';

var assert=require('assert');
var fs=require('fs');
var nubloxsql=require('../../../..');

async function main(){
  var password=process.env.MSSQL_SA_PASSWORD;
  var caPath=process.env.MSSQL_CA_PATH;
  if(!password)throw new Error('MSSQL_SA_PASSWORD is required');
  if(!caPath)throw new Error('MSSQL_CA_PATH is required');

  var exact='12345678901234567890.123456';
  var uuid='00112233-4455-6677-8899-aabbccddeeff';
  var decimalSpec={type:'decimal',precision:26,scale:6};
  var db=nubloxsql.createClient({
    dialect:'sqlserver',
    host:process.env.MSSQL_HOST||'127.0.0.1',
    port:Number(process.env.MSSQL_PORT||1433),
    user:'sa',password:password,database:'master',
    serverName:process.env.MSSQL_SERVER_NAME||'sqlserver',
    ca:fs.readFileSync(caPath),rejectUnauthorized:true,
    connectTimeout:5000,queryTimeout:15000,
    pool:{max:2}
  });

  try{
    var direct=await db.one(nubloxsql.sql`
      SELECT
        ${nubloxsql.sql.typed(exact,decimalSpec)} AS exact_decimal,
        ${nubloxsql.sql.typed(uuid,'uuid')} AS typed_uuid
    `);
    assert.strictEqual(direct.exact_decimal,exact);
    assert.strictEqual(direct.typed_uuid,uuid);

    var prepared=await db.prepare(nubloxsql.sql`
      SELECT
        ${nubloxsql.sql.parameter('amount',decimalSpec)} AS exact_decimal,
        ${nubloxsql.sql.parameter('id','uuid')} AS typed_uuid
    `);
    var preparedRow=await prepared.one({amount:exact,id:uuid});
    assert.strictEqual(preparedRow.exact_decimal,exact);
    assert.strictEqual(preparedRow.typed_uuid,uuid);
    await prepared.close();

    var rows=[];
    for await(var row of db.stream(nubloxsql.sql`
      SELECT ${nubloxsql.sql.typed(exact,decimalSpec)} AS exact_decimal
    `,{highWaterMark:1}))rows.push(row);
    assert.strictEqual(rows.length,1);
    assert.strictEqual(rows[0].exact_decimal,exact);

    var nulls=await db.one(nubloxsql.sql`
      SELECT
        ${nubloxsql.sql.typed(null,{type:'decimal',precision:18,scale:4})} AS decimal_null,
        ${nubloxsql.sql.typed(null,'uuid')} AS uuid_null
    `);
    assert.strictEqual(nulls.decimal_null,null);
    assert.strictEqual(nulls.uuid_null,null);

    console.log('NuBloxSQL live SQL Server strict-TDS8 portable typed decimal/UUID binds passed');
  }finally{await db.close();}
}
main().catch(function(error){console.error(error.stack||error);process.exitCode=1;});
