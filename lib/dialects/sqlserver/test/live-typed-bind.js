'use strict';

var assert=require('assert');
var fs=require('fs');
var nubloxsql=require('../../../..');

async function main(){
  var password=process.env.MSSQL_SA_PASSWORD,caPath=process.env.MSSQL_CA_PATH;
  if(!password)throw new Error('MSSQL_SA_PASSWORD is required');
  if(!caPath)throw new Error('MSSQL_CA_PATH is required');
  var exact='12345678901234567890.123456',uuid='00112233-4455-6677-8899-aabbccddeeff',decimalSpec={type:'decimal',precision:26,scale:6};
  var db=nubloxsql.createClient({dialect:'sqlserver',host:process.env.MSSQL_HOST||'127.0.0.1',port:Number(process.env.MSSQL_PORT||1433),user:'sa',password:password,database:'master',serverName:process.env.MSSQL_SERVER_NAME||'sqlserver',ca:fs.readFileSync(caPath),rejectUnauthorized:true,connectTimeout:5000,queryTimeout:15000,pool:{max:2}});
  try{
    var direct=await db.one(nubloxsql.sql`SELECT
      ${nubloxsql.sql.typed(exact,decimalSpec)} AS exact_decimal,
      ${nubloxsql.sql.typed(uuid,'uuid')} AS typed_uuid,
      ${nubloxsql.sql.typed('2028-02-29','date')} AS portable_date,
      ${nubloxsql.sql.typed('09:07:05.120000',{type:'time',scale:6})} AS portable_time,
      ${nubloxsql.sql.typed('2026-09-30 13:25:14.123000',{type:'timestamp',scale:6})} AS portable_timestamp`);
    assert.strictEqual(direct.exact_decimal,exact);assert.strictEqual(direct.typed_uuid,uuid);
    assert.strictEqual(direct.portable_date,'2028-02-29');
    assert.strictEqual(direct.portable_time,'09:07:05.120000');
    assert.strictEqual(direct.portable_timestamp,'2026-09-30T13:25:14.123000');

    var prepared=await db.prepare(nubloxsql.sql`SELECT
      ${nubloxsql.sql.parameter('amount',decimalSpec)} AS exact_decimal,
      ${nubloxsql.sql.parameter('id','uuid')} AS typed_uuid,
      ${nubloxsql.sql.parameter('d','date')} AS portable_date,
      ${nubloxsql.sql.parameter('t',{type:'time',scale:3})} AS portable_time,
      ${nubloxsql.sql.parameter('ts',{type:'timestamp',scale:6})} AS portable_timestamp`);
    var row=await prepared.one({amount:exact,id:uuid,d:'2024-02-29',t:'01:02:03.4',ts:'2024-02-29 01:02:03.4'});
    assert.strictEqual(row.portable_date,'2024-02-29');
    assert.strictEqual(row.portable_time,'01:02:03.400');
    assert.strictEqual(row.portable_timestamp,'2024-02-29T01:02:03.400000');
    await prepared.close();

    var rows=[];for await(var streamed of db.stream(nubloxsql.sql`SELECT ${nubloxsql.sql.typed('2030-12-31','date')} AS portable_date`,{highWaterMark:1}))rows.push(streamed);
    assert.strictEqual(rows[0].portable_date,'2030-12-31');
    console.log('NuBloxSQL live SQL Server portable exact and temporal typed binds passed');
  }finally{await db.close();}
}
main().catch(function(error){console.error(error.stack||error);process.exitCode=1;});
