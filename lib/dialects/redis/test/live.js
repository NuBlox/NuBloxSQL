'use strict';

// Runs against a real ephemeral Redis container in CI. Never targets
// production or executes administrative commands.
const assert = require('node:assert/strict');
const {createNativeConnection} = require('../../../..');

async function main() {
  const db = createNativeConnection('redis',{
    host:process.env.REDIS_HOST || '127.0.0.1',
    port:Number(process.env.REDIS_PORT || 6379),
    connectTimeout:10000,commandTimeout:10000
  });
  await db.connect();
  try {
    assert.equal(await db.ping(),'PONG');
    const key='nublox:ci:resp2:' + process.pid;
    assert.equal(await db.set(key,Buffer.from([0,255,7])),'OK');
    assert.deepEqual(await db.get(key),Buffer.from([0,255,7]));
    assert.equal(await db.command('EXISTS',key),1);
    assert.equal(await db.del(key),1);
    assert.equal(await db.get(key),null);
    const bulk=await db.command('MGET','redis:unknown:' + process.pid,'redis:missing:' + process.pid);
    assert.deepEqual(bulk,[null,null]);
    const reply=await Promise.all([db.ping(),db.ping(),db.ping()]);
    assert.deepEqual(reply,['PONG','PONG','PONG']);
    await assert.rejects(db.command('THIS_COMMAND_DOES_NOT_EXIST'),e=>e.code==='ERR');
    assert.equal(await db.ping(),'PONG');
  } finally {await db.close();}
  console.log('NuBloxSQL live Redis native RESP2 protocol: PASS');
}
main().catch(e=>{console.error(e.stack||e);process.exitCode=1;});
