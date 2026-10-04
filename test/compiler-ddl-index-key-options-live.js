'use strict';

var assert = require('assert');
var nublox = require('..');

function configFor(dialect) {
  if (dialect === 'postgresql') return { dialect:'postgresql', host:process.env.PGHOST||'127.0.0.1', port:Number(process.env.PGPORT||5432), user:process.env.PGUSER, password:process.env.PGPASSWORD, database:process.env.PGDATABASE, pool:{max:2} };
  if (dialect === 'mysql') return { dialect:'mysql', host:process.env.MYSQL_HOST||'127.0.0.1', port:Number(process.env.MYSQL_PORT||3306), user:process.env.MYSQL_USER, password:process.env.MYSQL_PASSWORD, database:process.env.MYSQL_DATABASE, ssl:'disable', getServerPublicKey:true, pool:{max:2} };
  if (dialect === 'sqlite') return { dialect:'sqlite', filename:':memory:', pool:false };
  throw new Error('Unsupported ddl-v9 live dialect: '+dialect);
}

async function main() {
  var dialect=process.env.NUBLOX_DIALECT||'sqlite';
  var db=nublox.createClient(configFor(dialect));
  var model=nublox.capabilityModel;
  var table='nublox_compiler_ddl_v9';
  var index=table+'_key_idx';

  async function dropIndex() {
    try {
      if (dialect==='mysql') await db.execute('DROP INDEX '+index+' ON '+table);
      else await db.execute('DROP INDEX IF EXISTS '+index);
    } catch (_) {}
  }

  try {
    await dropIndex();
    try { await db.execute('DROP TABLE IF EXISTS '+table); } catch (_) {}
    await db.execute('CREATE TABLE '+table+' (id INTEGER PRIMARY KEY, code VARCHAR(100) NOT NULL)');
    await db.execute("INSERT INTO "+table+" (id, code) VALUES (1, 'alpha'), (2, 'Beta'), (3, 'gamma')");

    var qualification=await model.qualifyClient(db);
    var source;
    if (dialect==='postgresql') source='CREATE INDEX '+index+' ON '+table+' (code COLLATE "C" text_pattern_ops DESC NULLS LAST)';
    else if (dialect==='mysql') source='CREATE INDEX '+index+' ON '+table+' (code DESC)';
    else source='CREATE INDEX '+index+' ON '+table+' (code COLLATE NOCASE DESC)';

    var result=model.transpileSql(dialect,dialect,source,{sourceQualification:qualification,targetQualification:qualification});
    assert.strictEqual(result.scope,'ddl-v9');
    assert.strictEqual(result.certified,true);
    await db.execute(result.sql);

    var rows=await db.all('SELECT code FROM '+table+' ORDER BY code DESC');
    assert.strictEqual(rows.length,3);
  } finally {
    await dropIndex();
    try { await db.execute('DROP TABLE IF EXISTS '+table); } catch (_) {}
    await db.close();
  }

  console.log('NuBloxSQL Wave 5i live index key option qualification: PASS for '+dialect);
}

main().catch(function(error){console.error(error&&error.stack?error.stack:error);process.exitCode=1;});
