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
var PARAM_UNICODE_MAX='NuBlox input Ω 🚀 '.repeat(700);
var PARAM_BINARY_MAX=Buffer.alloc(12000,0x5a);
var SELECT_MAX=[
  'SELECT',
  "REPLICATE(CAST(N'NuBlox Ω ' AS nvarchar(max)), 1200) AS unicode_max,",
  "REPLICATE(CAST('portable-sql-' AS varchar(max)), 1000) AS varchar_max,",
  "CONVERT(varbinary(max), REPLICATE(CAST('AB' AS varchar(max)), 6000)) AS binary_max"
].join('\n');

var WESTERN='NuBlox € café';
var CYRILLIC='Привет';
var UTF8_VALUE='NuBlox Ω 🚀';
var WESTERN_MAX='€ café '.repeat(1200);
var SELECT_COLLATIONS=[
  'SELECT',
  "CAST(N'NuBlox € café' COLLATE Latin1_General_100_CI_AS AS varchar(100)) AS western_1252,",
  "CAST(N'Привет' COLLATE Cyrillic_General_100_CI_AS AS varchar(100)) AS cyrillic_1251,",
  "CAST(N'NuBlox Ω 🚀' COLLATE Latin1_General_100_CI_AS_SC_UTF8 AS varchar(100)) AS utf8_value,",
  "CAST(REPLICATE(CAST(N'€ café ' AS nvarchar(max)),1200) COLLATE Latin1_General_100_CI_AS AS varchar(max)) AS western_max"
].join('\n');

var SELECT_VARIANTS=[
  'SELECT',
  "CAST(CAST(42 AS int) AS sql_variant) AS variant_int,",
  "CAST(CAST(9223372036854775807 AS bigint) AS sql_variant) AS variant_bigint,",
  "CAST(CAST('1234567890.1234' AS decimal(14,4)) AS sql_variant) AS variant_decimal,",
  "CAST(CAST('00112233-4455-6677-8899-AABBCCDDEEFF' AS uniqueidentifier) AS sql_variant) AS variant_guid,",
  "CAST(CAST('2026-09-29' AS date) AS sql_variant) AS variant_date,",
  "CAST(CAST(N'Привет' AS nvarchar(20)) AS sql_variant) AS variant_unicode,",
  "CAST(CAST(N'NuBlox € café' COLLATE Latin1_General_100_CI_AS AS varchar(100)) AS sql_variant) AS variant_varchar,",
  "CAST(CAST(0x001122AABB AS varbinary(20)) AS sql_variant) AS variant_binary,",
  "CAST(NULL AS sql_variant) AS variant_null"
].join('\n');
var EXPECTED_VARIANTS={
  variant_int:42,
  variant_bigint:9223372036854775807n,
  variant_decimal:'1234567890.1234',
  variant_guid:'00112233-4455-6677-8899-aabbccddeeff',
  variant_date:'2026-09-29',
  variant_unicode:'Привет',
  variant_varchar:'NuBlox € café',
  variant_binary:Buffer.from([0x00,0x11,0x22,0xaa,0xbb]),
  variant_null:null
};

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

    var maxParameters=await db.one(nubloxsql.sql`
      SELECT
        ${PARAM_UNICODE_MAX} AS unicode_input,
        DATALENGTH(${PARAM_UNICODE_MAX}) AS unicode_bytes,
        ${PARAM_BINARY_MAX} AS binary_input,
        DATALENGTH(${PARAM_BINARY_MAX}) AS binary_bytes
    `);
    assert.strictEqual(maxParameters.unicode_input,PARAM_UNICODE_MAX);
    assert.strictEqual(maxParameters.unicode_bytes,Buffer.byteLength(PARAM_UNICODE_MAX,'utf16le'));
    assert.deepStrictEqual(maxParameters.binary_input,PARAM_BINARY_MAX);
    assert.strictEqual(maxParameters.binary_bytes,PARAM_BINARY_MAX.length);

    var collated=await db.query(SELECT_COLLATIONS);
    assert.strictEqual(collated.rows.length,1);
    assert.strictEqual(collated.rows[0].western_1252,WESTERN);
    assert.strictEqual(collated.rows[0].cyrillic_1251,CYRILLIC);
    assert.strictEqual(collated.rows[0].utf8_value,UTF8_VALUE);
    assert.strictEqual(collated.rows[0].western_max,WESTERN_MAX);
    var collatedFields=collated.native.columns;
    assert.strictEqual(collatedFields.find(function(field){return field.name==='western_1252';}).collationInfo.codePage,1252);
    assert.strictEqual(collatedFields.find(function(field){return field.name==='cyrillic_1251';}).collationInfo.codePage,1251);
    var utf8Field=collatedFields.find(function(field){return field.name==='utf8_value';});
    assert.strictEqual(utf8Field.collationInfo.codePage,65001);
    assert.strictEqual(utf8Field.collationInfo.utf8,true);

    var collatedStream=[];
    for await (var collatedRow of db.stream(SELECT_COLLATIONS,{highWaterMark:1})) collatedStream.push(collatedRow);
    assert.strictEqual(collatedStream.length,1);
    assert.strictEqual(collatedStream[0].western_1252,WESTERN);
    assert.strictEqual(collatedStream[0].cyrillic_1251,CYRILLIC);
    assert.strictEqual(collatedStream[0].utf8_value,UTF8_VALUE);
    assert.strictEqual(collatedStream[0].western_max,WESTERN_MAX);

    var variants=await db.query(SELECT_VARIANTS);
    assert.strictEqual(variants.rows.length,1);
    assert.deepStrictEqual(variants.rows[0],EXPECTED_VARIANTS);
    variants.native.columns.forEach(function(field){assert.strictEqual(field.type,0x62);assert.ok(field.maxLength>=8000);});

    var variantStream=[];
    for await (var variantRow of db.stream(SELECT_VARIANTS,{highWaterMark:1})) variantStream.push(variantRow);
    assert.deepStrictEqual(variantStream,[EXPECTED_VARIANTS]);

    console.log('NuBloxSQL live SQL Server lossless type, PLP/MAX input/output, collation and sql_variant fidelity passed');
  } finally {
    await db.close();
  }
}

main().catch(function(error){console.error(error.stack||error);process.exitCode=1;});
