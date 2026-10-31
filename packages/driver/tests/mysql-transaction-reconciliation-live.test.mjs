import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {connectDatabase,createDatabasePool} from '../dist/index.js';
import {ConnectionPool} from '../dist/core/pooling.js';
import {startMysqlFaultProxy} from './fixtures/mysql-fault-proxy.mjs';

const live=process.env.NUBLOX_LIVE_MYSQL==='1'?test:test.skip;
const target={
  engine:'mysql',host:'127.0.0.1',port:Number(process.env.MYSQL_PORT??3306),
  user:process.env.MYSQL_USER??'root',
  password:process.env.MYSQL_PASSWORD??'test-password',
  database:process.env.MYSQL_DATABASE??'nublox_test',
  security:'isolated-local',timeoutMs:10000
};
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function withFixture(work){
  // A random test-owned table and token avoid any production schema and
  // distinguish a durable write from an attempted but rolled-back write.
  const table='nublox_reconcile_'+randomUUID().replaceAll('-','').slice(0,16);
  const db=await connectDatabase(target);
  try{
    await db.query(`CREATE TABLE \`${table}\` (
      token CHAR(36) NOT NULL PRIMARY KEY,
      amount INT NOT NULL
    ) ENGINE=InnoDB`);
    return await work(table);
  }finally{
    try{await db.query(`DROP TABLE IF EXISTS \`${table}\``);}
    finally{await db.close();}
  }
}
async function countByToken(table,token){
  // Independent authenticated session, not a reused poisoned transaction.
  const verifier=await connectDatabase(target);
  try{
    const result=await verifier.query(
      `SELECT COUNT(*) AS n FROM \`${table}\` WHERE token = ?`,[token]);
    return result.rows[0].n;
  }finally{await verifier.close();}
}

live('real COMMIT completed but its acknowledgement lost: reconcile one durable token without SQL replay',
  {timeout:30000},async()=>{
  await withFixture(async table=>{
    const proxy=await startMysqlFaultProxy(target.port);
    const pool=createDatabasePool({...target,port:proxy.port},
      {maxConnections:1,acquireTimeoutMs:10000,healthCheckTimeoutMs:2000});
    const token=randomUUID();
    let callbacks=0,writes=0;
    try{
      await assert.rejects(pool.withConnection(async lease=>
        lease.transaction(async tx=>{
          callbacks++;
          await tx.query(
            `INSERT INTO \`${table}\` (token,amount) VALUES (?,?)`,[token,701]);
          writes++;
          // Proxy replaces the server's actual, successful COMMIT OK packet.
          // The server has committed, but the client cannot certify it.
          proxy.arm('short-ok');
          return 'unconfirmable';
        })
      ),error=>error.code==='TRANSACTION_OUTCOME_UNKNOWN');
      assert.equal(proxy.injected,1,'exactly one COMMIT reply was corrupted');
      assert.equal(callbacks,1,'never replay an application transaction');
      assert.equal(writes,1,'only one write was dispatched by the application');
      assert.ok(pool.stats.discarded>=1,'the ambiguous socket cannot return to the pool');
      assert.equal(await countByToken(table,token),1n,
        'read-only reconciliation finds the durable token despite missing ACK');
      const confirmed=await pool.withConnection(async lease=>
        (await lease.query('SELECT ? AS recovered',[702])).rows[0].recovered);
      assert.equal(confirmed,702n,'a newly authenticated pooled session is healthy');
      assert.ok(pool.stats.created>=2,'the pool opened a replacement physical socket');
      assert.equal(pool.stats.pending,0);
      assert.equal(callbacks,1,'recovery must not silently replay user work');
    }finally{
      await pool.close();
      await proxy.close();
    }
    assert.equal(pool.stats.size,0);
  });
});

live('COMMIT never sent: missing acknowledgement is still unknown, reconcile token as absent',
  {timeout:30000},async()=>{
  await withFixture(async table=>{
    const token=randomUUID();
    let armed=false,attempted=0,forwarded=0,callbacks=0,writes=0;
    const pool=new ConnectionPool(async()=>{
      const db=await connectDatabase(target);
      const nativeSend=db.stream.send.bind(db.stream);
      db.stream.send=async frame=>{
        const commit=frame[0]===0x03&&frame.subarray(1).toString('ascii')==='COMMIT';
        if(commit&&armed){
          attempted++;
          armed=false;
          // Drop transport before forwarding COMMIT. The server must roll
          // back the preceding InnoDB INSERT when its socket disappears.
          db.socket.destroy();
          throw Error('Test fixture dropped the unsent COMMIT');
        }
        if(commit)forwarded++;
        return nativeSend(frame);
      };
      return db;
    },{maxConnections:1,acquireTimeoutMs:10000,healthCheckTimeoutMs:2000});
    try{
      await assert.rejects(pool.withConnection(async lease=>
        lease.transaction(async tx=>{
          callbacks++;
          await tx.query(
            `INSERT INTO \`${table}\` (token,amount) VALUES (?,?)`,[token,703]);
          writes++;
          armed=true;
        })
      ),error=>error.code==='TRANSACTION_OUTCOME_UNKNOWN');
      assert.equal(attempted,1,'COMMIT was attempted only once');
      assert.equal(forwarded,0,'COMMIT was never sent to MySQL');
      assert.equal(callbacks,1);
      assert.equal(writes,1);
      assert.ok(pool.stats.discarded>=1,'do not reuse the uncertain session');
      // The server may still be closing the detached socket; reconcile from
      // a clean authenticated connection, without issuing another write.
      let count;
      for(let i=0;i<10;i++){
        count=await countByToken(table,token);
        if(count===0n)break;
        await pause(50);
      }
      assert.equal(count,0n,'unsent COMMIT leaves no durable token');
      const fresh=await pool.withConnection(async lease=>
        (await lease.query('SELECT ? AS recovered',[704])).rows[0].recovered);
      assert.equal(fresh,704n);
      assert.ok(pool.stats.created>=2);
      assert.equal(pool.stats.pending,0);
      assert.equal(callbacks,1,'the pool must never replay the rejected write');
    }finally{await pool.close();}
    assert.equal(pool.stats.size,0);
  });
});
