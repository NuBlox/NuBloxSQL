'use strict';

var assert = require('assert');
var nublox = require('..');

function configFor(dialect) {
  if (dialect === 'postgresql') return { dialect:'postgresql', host:process.env.PGHOST||'127.0.0.1', port:Number(process.env.PGPORT||5432), user:process.env.PGUSER, password:process.env.PGPASSWORD, database:process.env.PGDATABASE, pool:{max:2} };
  if (dialect === 'mysql') return { dialect:'mysql', host:process.env.MYSQL_HOST||'127.0.0.1', port:Number(process.env.MYSQL_PORT||3306), user:process.env.MYSQL_USER, password:process.env.MYSQL_PASSWORD, database:process.env.MYSQL_DATABASE, ssl:'disable', getServerPublicKey:true, pool:{max:2} };
  if (dialect === 'sqlite') return { dialect:'sqlite', filename:':memory:', pool:false };
  throw new Error('Unsupported ddl-v10 live dialect: '+dialect);
}

async function main() {
  var dialect=process.env.NUBLOX_DIALECT||'sqlite';
  var db=nublox.createClient(configFor(dialect));
  var model=nublox.capabilityModel;
  var sourceTable='nublox_compiler_ddl_v10_source';
  var targetTable='nublox_compiler_ddl_v10_target';

  try {
    try { await db.execute('DROP TABLE IF EXISTS '+targetTable); } catch (_) {}
    try { await db.execute('DROP TABLE IF EXISTS '+sourceTable); } catch (_) {}
    await db.execute('CREATE TABLE '+sourceTable+' (id INTEGER PRIMARY KEY, code VARCHAR(100) NOT NULL)');
    await db.execute("INSERT INTO "+sourceTable+" (id, code) VALUES (1, 'one'), (2, 'two'), (3, 'three')");

    var qualification=await model.qualifyClient(db);
    var source='CREATE TABLE IF NOT EXISTS '+targetTable+' AS SELECT id, code FROM '+sourceTable+' WHERE id >= 2';
    var result=model.transpileSql(dialect,dialect,source,{sourceQualification:qualification,targetQualification:qualification});
    assert.strictEqual(result.scope,'ddl-v10');
    assert.strictEqual(result.certified,true);
    await db.execute(result.sql);

    var rows=await db.all('SELECT id, code FROM '+targetTable+' ORDER BY id');
    assert.strictEqual(rows.length,2);
    assert.strictEqual(Number(rows[0].id),2);
    assert.strictEqual(rows[0].code,'two');

    await db.execute(result.sql);
    var count=await db.one('SELECT COUNT(*) AS n FROM '+targetTable);
    assert.strictEqual(Number(count.n),2);
  } finally {
    try { await db.execute('DROP TABLE IF EXISTS '+targetTable); } catch (_) {}
    try { await db.execute('DROP TABLE IF EXISTS '+sourceTable); } catch (_) {}
    await db.close();
  }

  console.log('NuBloxSQL Wave 5j live CREATE TABLE AS qualification: PASS for '+dialect);
}

main().catch(function(error){console.error(error&&error.stack?error.stack:error);process.exitCode=1;});
