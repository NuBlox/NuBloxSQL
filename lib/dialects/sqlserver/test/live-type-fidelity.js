'use strict';

var assert = require('assert');
var fs = require('fs');
var nubloxsql = require('../../../..');

var SELECT_TYPES = [
  "SELECT",
  "CAST('12345678901234567890.123456' AS decimal(26,6)) AS exact_decimal,",
  "CAST('-98765.4321' AS money) AS money_value,",
  "CAST('123.4567' AS smallmoney) AS small_money,",
  "CAST('00112233-4455-6677-8899-AABBCCDDEEFF' AS uniqueidentifier) AS guid_value,",
  "CAST('2026-09-29' AS date) AS date_value,",
  "CAST('13:14:15.1234567' AS time(7)) AS time_value,",
  "CAST('2026-09-29T13:14:15.1234567' AS datetime2(7)) AS datetime2_value,",
  "CAST('2026-09-29T13:14:15.1234567+01:30' AS datetimeoffset(7)) AS datetimeoffset_value"
].join('\n');

var EXPECTED = {
  exact_decimal:'12345678901234567890.123456',
  money_value:'-98765.4321',
  small_money:'123.4567',
  guid_value:'00112233-4455-6677-8899-aabbccddeeff',
  date_value:'2026-09-29',
  time_value:'13:14:15.1234567',
  datetime2_value:'2026-09-29T13:14:15.1234567',
  datetimeoffset_value:'2026-09-29T13:14:15.1234567+01:30'
};

var UNICODE_MAX='NuBlox Ω '.repeat(1200);
var VARCHAR_MAX='portable-sql-'.repeat(1000);
var BINARY_MAX=Buffer.from('AB'.repeat(6000),'ascii');
var SELECT_MAX=[
  'SELECT',
  "REPLICATE(CAST(N'NuBlox Ω ' AS nvarchar(max)), 1200) AS unicode_max,",
  "REPLICATE(CAST('portable-sql-' AS varchar(max)), 1000) AS varchar_max,",
  "CONVERT(varbinary(max), REPLICATE(CAST('AB' AS varchar(max)), 6000)) AS binary_max"
].join('\n');

async function main() {
  var password=process.env.MSSQL_SA_PASSWORD;
  var caPath=process.env.MSSQL_CA_PATH;
  if(!password)throw new Error('MSSQL_SA_PASSWORD is required');
  if(!caPath)throw new Error('MSSQL_CA_PATH is required');

  var db=nubloxsql.createClient({
    dialect:'sqlserver',
    host:process.env.MSSQL_HOST||'127.0.0.1',
    port:Number(process.env.MSSQL_PORT||1433),
    user:'sa',password:password,database:'master',
    serverName:process.env.MSSQL_SERVER_NAME||'sqlserver',
    ca:fs.readFileSync(caPath),rejectUnauthorized:true,
    connectTimeout:5000,queryTimeout:15000,
    pool:{max:1}
  });

  try {
    var result=await db.query(SELECT_TYPES);
    assert.strictEqual(result.rows.length,1);
    assert.deepStrictEqual(result.rows[0],EXPECTED);
    var nativeFields=result.native.columns;
    var decimalField=nativeFields.find(function(field){return field.name==='exact_decimal';});
    var timeField=nativeFields.find(function(field){return field.name==='time_value';});
    assert.strictEqual(decimalField.precision,26);
    assert.strictEqual(decimalField.scale,6);
    assert.strictEqual(timeField.scale,7);

    var streamed=[];
    for await (var row of db.stream(SELECT_TYPES,{highWaterMark:1})) streamed.push(row);
    assert.deepStrictEqual(streamed,[EXPECTED]);

    db.types.registerColumn('exact_decimal',function(value){return 'decimal:'+value;});
    var decoded=await db.one(SELECT_TYPES);
    assert.strictEqual(decoded.exact_decimal,'decimal:12345678901234567890.123456');

    var maxResult=await db.query(SELECT_MAX);
    assert.strictEqual(maxResult.rows.length,1);
    assert.strictEqual(maxResult.rows[0].unicode_max,UNICODE_MAX);
    assert.strictEqual(maxResult.rows[0].varchar_max,VARCHAR_MAX);
    assert.deepStrictEqual(maxResult.rows[0].binary_max,BINARY_MAX);
    maxResult.native.columns.forEach(function(field){assert.strictEqual(field.maxLength,0xffff);});

    var maxStream=[];
    for await (var maxRow of db.stream(SELECT_MAX,{highWaterMark:1})) maxStream.push(maxRow);
    assert.strictEqual(maxStream.length,1);
    assert.strictEqual(maxStream[0].unicode_max,UNICODE_MAX);
    assert.strictEqual(maxStream[0].varchar_max,VARCHAR_MAX);
    assert.deepStrictEqual(maxStream[0].binary_max,BINARY_MAX);

    console.log('NuBloxSQL live SQL Server lossless type and PLP/MAX fidelity passed');
  } finally {
    await db.close();
  }
}

main().catch(function(error){console.error(error.stack||error);process.exitCode=1;});
