'use strict';

var assert = require('assert');
var nublox = require('..');

function configFor(dialect) {
  if (dialect === 'postgresql') return { dialect:'postgresql', host:process.env.PGHOST||'127.0.0.1', port:Number(process.env.PGPORT||5432), user:process.env.PGUSER, password:process.env.PGPASSWORD, database:process.env.PGDATABASE, pool:{max:2} };
  if (dialect === 'mysql') return { dialect:'mysql', host:process.env.MYSQL_HOST||'127.0.0.1', port:Number(process.env.MYSQL_PORT||3306), user:process.env.MYSQL_USER, password:process.env.MYSQL_PASSWORD, database:process.env.MYSQL_DATABASE, ssl:'disable', getServerPublicKey:true, pool:{max:2} };
  if (dialect === 'sqlite') return { dialect:'sqlite', filename:':memory:', pool:false };
  throw new Error('Unsupported ddl-v8 live dialect: '+dialect);
}

async function main() {
  var dialect=process.env.NUBLOX_DIALECT||'sqlite';
  var db=nublox.createClient(configFor(dialect));
  var model=nublox.capabilityModel;
  var table='nublox_compiler_ddl_v8';
  var index=table+'_expr_idx';
  var methodIndex=table+'_method_idx';

  async function dropIndex(name) {
    try {
      if (dialect==='mysql') await db.execute('DROP INDEX '+name+' ON '+table);
      else await db.execute('DROP INDEX IF EXISTS '+name);
    } catch (_) {}
  }

  try {
    await dropIndex(methodIndex);
    await dropIndex(index);
    try { await db.execute('DROP TABLE IF EXISTS '+table); } catch (_) {}
    await db.execute('CREATE TABLE '+table+' (id INTEGER PRIMARY KEY, code VARCHAR(100) NOT NULL)');
    await db.execute("INSERT INTO "+table+" (id, code) VALUES (1, 'Alpha'), (2, 'Beta')");

    var qualification=await model.qualifyClient(db);
    function compile(source) {
      var options={targetQualification:qualification,sourceQualification:qualification};
      var result=model.transpileSql(dialect,dialect,source,options);
      assert.strictEqual(result.scope,'ddl-v8');
      assert.strictEqual(result.certified,true);
      return result;
    }

    if (dialect==='postgresql') {
      var pg=compile('CREATE INDEX '+index+' ON '+table+' USING btree ((lower(code))) INCLUDE (id)');
      assert.ok(/USING btree/.test(pg.sql));
      assert.ok(/INCLUDE/.test(pg.sql));
      await db.execute(pg.sql);
      var method=compile('CREATE INDEX '+methodIndex+' ON '+table+' USING hash (code)');
      await db.execute(method.sql);
    } else if (dialect==='mysql') {
      var my=compile('CREATE INDEX '+index+' ON '+table+' ((lower(code)))');
      assert.ok(/\(\(lower\(/i.test(my.sql));
      await db.execute(my.sql);
    } else {
      var sq=compile('CREATE INDEX '+index+' ON '+table+' ((lower(code)))');
      await db.execute(sq.sql);
    }

    var rows=await db.all('SELECT id FROM '+table+" WHERE lower(code) = 'alpha'");
    assert.strictEqual(rows.length,1);
    assert.strictEqual(Number(rows[0].id),1);
  } finally {
    await dropIndex(methodIndex);
    await dropIndex(index);
    try { await db.execute('DROP TABLE IF EXISTS '+table); } catch (_) {}
    await db.close();
  }
  console.log('NuBloxSQL Wave 5h live advanced index qualification: PASS for '+dialect);
}

main().catch(function(error){console.error(error&&error.stack?error.stack:error);process.exitCode=1;});
