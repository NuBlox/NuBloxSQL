'use strict';

var assert = require('assert');
var nublox = require('..');
var sql = nublox.sql;

function configFor(dialect) {
  var base;
  if (dialect === 'mysql') base = {
    dialect:'mysql',host:process.env.MYSQL_HOST||'127.0.0.1',port:Number(process.env.MYSQL_PORT||3306),
    user:process.env.MYSQL_USER,password:process.env.MYSQL_PASSWORD,database:process.env.MYSQL_DATABASE,
    ssl:'disable',getServerPublicKey:true,pool:{max:2}
  };
  else if (dialect === 'postgresql') base = {
    dialect:'postgresql',host:process.env.PGHOST||'127.0.0.1',port:Number(process.env.PGPORT||5432),
    user:process.env.PGUSER,password:process.env.PGPASSWORD,database:process.env.PGDATABASE,pool:{max:2}
  };
  else throw new Error('Unsupported dialect: '+dialect);
  base.types={encode:function(value){if(value&&value.__codecProbe)return value.value;return value;},columns:{codec_probe:function(value,context){assert.strictEqual(context.dialect,dialect);return String(value).toUpperCase();}}};
  return base;
}

async function main() {
  var dialect=process.env.NUBLOX_DIALECT;if(!dialect)throw new Error('NUBLOX_DIALECT is required');
  var db=nublox.createClient(configFor(dialect));
  try {
    var row=await db.one(sql`SELECT ${{__codecProbe:true,value:'portable'}} AS codec_probe`);
    assert.strictEqual(row.codec_probe,'PORTABLE');
    db.types.registerColumn('codec_probe',function(value){return '['+value+']';});
    row=await db.one(sql`SELECT ${'native'} AS codec_probe`);assert.strictEqual(row.codec_probe,'[native]');

    var temporal=await db.one(sql`SELECT
      ${sql.typed('2028-02-29','date')} AS portable_date,
      ${sql.typed('09:07:05.120000',{type:'time',scale:6})} AS portable_time,
      ${sql.typed('2026-09-30 13:25:14.123000',{type:'timestamp',scale:6})} AS portable_timestamp`);
    function text(value){return value instanceof Date?value.toISOString():String(value);}
    assert.ok(text(temporal.portable_date).indexOf('2028-02-29')!==-1);
    assert.ok(text(temporal.portable_time).indexOf('09:07:05.12')!==-1);
    assert.ok(text(temporal.portable_timestamp).indexOf('2026-09-30')!==-1);
    assert.ok(text(temporal.portable_timestamp).indexOf('13:25:14.123')!==-1);

    var prepared=await db.prepare(sql`SELECT
      ${sql.parameter('d','date')} AS portable_date,
      ${sql.parameter('t',{type:'time',scale:3})} AS portable_time,
      ${sql.parameter('ts',{type:'timestamp',scale:6})} AS portable_timestamp`);
    var preparedRow=await prepared.one({d:'2024-02-29',t:'01:02:03.4',ts:'2024-02-29 01:02:03.4'});
    assert.ok(text(preparedRow.portable_date).indexOf('2024-02-29')!==-1);
    assert.ok(text(preparedRow.portable_time).indexOf('01:02:03.4')!==-1);
    assert.ok(text(preparedRow.portable_timestamp).indexOf('2024-02-29')!==-1);
    await prepared.close();

    var stream=db.stream(sql`SELECT ${sql.typed('2030-12-31','date')} AS stream_date`);
    var item=await stream.next();assert.ok(text(item.value.stream_date).indexOf('2030-12-31')!==-1);await stream.close();
    console.log('NuBloxSQL live portable codec/temporal typed-bind contract passed for '+dialect);
  } finally { await db.close(); }
}
main().catch(function(error){console.error(error.stack||error);process.exitCode=1;});
