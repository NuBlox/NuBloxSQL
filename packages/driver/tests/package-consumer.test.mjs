import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,existsSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../../../',import.meta.url));
const npm=process.platform==='win32'?'npm.cmd':'npm';
const consumer=`
import assert from 'node:assert/strict';
import {connectDatabase,createDatabasePool,DriverError} from '@nublox/driver';
assert.equal(typeof connectDatabase,'function');
assert.equal(typeof createDatabasePool,'function');
assert.equal(typeof DriverError,'function');
await assert.rejects(connectDatabase({engine:'unknown'}),error=>error.code==='UNSUPPORTED_ENGINE');
if(process.env.NUBLOX_LIVE_MYSQL==='1'){
  const session=await connectDatabase({
    engine:'mysql',host:'127.0.0.1',port:Number(process.env.MYSQL_PORT||3306),
    user:process.env.MYSQL_USER||'root',password:process.env.MYSQL_PASSWORD||'test-password',
    database:'nublox_test',security:'isolated-local'
  });
  try{
    const result=await session.query('SELECT ? AS consumer_value',[41]);
    assert.equal(result.rows[0].consumer_value,41n);
    const cancelled=new AbortController();
    cancelled.abort();
    await assert.rejects(
      session.query('SELECT 1',[],{signal:cancelled.signal}),
      error=>error.code==='CANCELLED'
    );
    assert.equal(session.closed,false);
    assert.equal((await session.query('SELECT ? AS still_connected',[42])).rows[0].still_connected,42n);
    const statement=await session.prepare('SELECT ? AS packaged_statement');
    try{
      assert.equal(statement.parameterCount,1);
      assert.equal((await statement.execute([43])).rows[0].packaged_statement,43n);
      assert.equal((await statement.execute([44])).rows[0].packaged_statement,44n);
    }finally{await statement.close();}
    await assert.rejects(statement.execute([45]),e=>e.code==='CONNECTION_CLOSED');
  }finally{await session.close();}
  assert.equal(session.closed,true);
  const pool=createDatabasePool({
    engine:'mysql',host:'127.0.0.1',port:Number(process.env.MYSQL_PORT||3306),
    user:process.env.MYSQL_USER||'root',password:process.env.MYSQL_PASSWORD||'test-password',
    database:'nublox_test',security:'isolated-local'
  },{maxConnections:1});
  try{
    const first=await pool.withConnection(async borrowed=>{
      await borrowed.query('SET @nublox_consumer_pool = 246');
      return (await borrowed.query('SELECT CONNECTION_ID() AS id')).rows[0].id;
    });
    await pool.withConnection(async borrowed=>{
      assert.equal((await borrowed.query('SELECT @nublox_consumer_pool AS marker')).rows[0].marker,null);
      assert.equal((await borrowed.query('SELECT CONNECTION_ID() AS id')).rows[0].id,first);
      const statement=await borrowed.prepare('SELECT ? AS pooled_statement');
      try {
        assert.equal((await statement.execute([46])).rows[0].pooled_statement,46n);
      }finally {await statement.close();}

    });
  }finally{await pool.close();}
  assert.equal(pool.closed,true);
  assert.ok(pool.stats.healthChecks>=2);
  assert.equal(pool.stats.healthFailures,0);
  assert.equal(pool.stats.size,0);
}
`;

test('published tarball installs and works from an unrelated application',()=>{
  const temp=mkdtempSync(join(tmpdir(),'nublox-driver-consumer-'));
  try{
    const filename=execFileSync(npm,['pack','--silent','--workspace','@nublox/driver','--pack-destination',temp],{cwd:root,encoding:'utf8'}).trim().split('\n').at(-1);
    assert.match(filename,/\.tgz$/);
    const archive=join(temp,filename);
    assert.ok(existsSync(archive),'npm pack must produce a package archive');
    execFileSync(npm,['install','--offline','--no-audit','--no-fund','--ignore-scripts','--prefix',temp,archive],{cwd:temp,stdio:'pipe'});
    const script=join(temp,'consumer.mjs');
    writeFileSync(script,consumer);
    execFileSync(process.execPath,[script],{cwd:temp,stdio:'pipe',env:process.env});
  }finally{rmSync(temp,{recursive:true,force:true});}
});
