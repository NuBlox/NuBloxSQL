import {test} from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {connectDatabase} from '../dist/index.js';

const live=process.env.NUBLOX_LIVE_MYSQL==='1'?test:test.skip;
const target={
  engine:'mysql',host:'127.0.0.1',port:Number(process.env.MYSQL_PORT||3306),
  user:process.env.MYSQL_USER||'root',password:process.env.MYSQL_PASSWORD||'test-password',
  database:'nublox_test',security:'isolated-local',timeoutMs:5000
};
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));

live('transport loss interrupts waiting transaction and rejects queued commands immediately',{timeout:7000},async()=>{
  const db=await connectDatabase(target);
  let entered,release;
  const started=new Promise(resolve=>{entered=resolve;});
  const gate=new Promise(resolve=>{release=resolve;});
  try{
    const statement=await db.prepare('SELECT ? AS protected');
    const active=db.transaction(async tx=>{
      assert.equal((await tx.query('SELECT ? AS inside',[11])).rows[0].inside,11n);
      entered();
      await gate; // The callback is waiting for application work, not wire I/O.
      return 'must-not-commit';
    });
    void active.catch(()=>{});
    await started;
    const queued=Array.from({length:32},(_,i)=>db.query('SELECT ? AS queued',[i]));
    const queuedResults=Promise.allSettled(queued);
    const disconnected=once(db.socket,'close');
    db.socket.destroy();
    await disconnected;
    const outcome=await Promise.race([
      active.then(()=> 'resolved',error=>error.code),
      sleep(650).then(()=> 'still-pending')
    ]);
    assert.equal(outcome,'CONNECTION_CLOSED',
      'a fatal transport must settle active work before callback or timeout');
    const failures=await queuedResults;
    assert.ok(failures.every(result=>
      result.status==='rejected'&&result.reason.code==='CONNECTION_CLOSED'
    ));
    assert.equal(db.closed,true);
    assert.equal(statement.closed,true);
    await assert.rejects(statement.execute([12]),e=>e.code==='CONNECTION_CLOSED');
    await statement.close();
    await assert.rejects(db.query('SELECT 3'),e=>e.code==='CONNECTION_CLOSED');
  }finally{
    release?.();
    await db.close();
  }
});

live('transport loss immediately invalidates an active cursor and settles its callback',{timeout:7000},async()=>{
  const db=await connectDatabase(target);
  let entered,release,cursor;
  const started=new Promise(resolve=>{entered=resolve;});
  const gate=new Promise(resolve=>{release=resolve;});
  try{
    const active=db.withCursor('SELECT ? AS value',[17],async current=>{
      cursor=current;
      entered();
      await gate; // No pending fetch: disconnection must still revoke the cursor.
      return 'must-not-complete';
    },{fetchSize:1});
    void active.catch(()=>{});
    await started;
    assert.equal(cursor.closed,false);
    const disconnected=once(db.socket,'close');
    db.socket.destroy();
    await disconnected;
    assert.equal(db.closed,true);
    assert.equal(cursor.closed,true,'escaped native cursor must be revoked immediately');
    assert.deepEqual(await cursor.next(),{done:true,value:undefined});
    const outcome=await Promise.race([
      active.then(()=> 'resolved',error=>error.code),
      sleep(650).then(()=> 'still-pending')
    ]);
    assert.equal(outcome,'CONNECTION_CLOSED');
    const replacement=await connectDatabase(target);
    try{
      assert.equal((await replacement.query('SELECT ? AS healthy',[18])).rows[0].healthy,18n);
    }finally{await replacement.close();}
  }finally{
    release?.();
    await db.close();
  }
});
