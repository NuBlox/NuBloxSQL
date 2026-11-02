import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {connectDatabase,createDatabasePool} from '../dist/index.js';

const live=process.env.NUBLOX_LIVE_MYSQL==='1'?test:test.skip;
const target={
  engine:'mysql',host:'127.0.0.1',port:Number(process.env.MYSQL_PORT??3306),
  user:process.env.MYSQL_USER??'root',password:process.env.MYSQL_PASSWORD??'test-password',
  database:process.env.MYSQL_DATABASE??'nublox_test',
  security:'isolated-local',timeoutMs:10000
};
const tableName=()=> 'nublox_boundary_'+randomUUID().replaceAll('-','').slice(0,16);
live('DDL implicit COMMIT is detected, prior durable write is reconciled, pool replaces socket',
  {timeout:30000},async()=>{
  const table=tableName(),ddl=tableName();
  const setup=await connectDatabase(target);
  try{
    await setup.query(`CREATE TABLE \`${table}\` (id INT PRIMARY KEY, amount INT) ENGINE=InnoDB`);
  }finally{await setup.close();}
  const pool=createDatabasePool(target,{maxConnections:1,acquireTimeoutMs:10000});
  try{
    let callbackRuns=0;
    await assert.rejects(pool.withConnection(lease=>lease.transaction(async tx=>{
      callbackRuns++;
      await tx.query(`INSERT INTO \`${table}\` (id,amount) VALUES (?,?)`,[101,79]);
      // MySQL commits the INSERT BEFORE executing this DDL.
      await tx.query(`CREATE TABLE \`${ddl}\` (id INT PRIMARY KEY) ENGINE=InnoDB`);
      throw Error('should not continue after implicit commit');
    })),error=>error.code==='TRANSACTION_OUTCOME_UNKNOWN');
    assert.equal(callbackRuns,1,'transaction callback must not replay');
    assert.ok(pool.stats.discarded>=1,'implicit commit invalidates the native lease');
    const count=await pool.withConnection(async lease=>
      (await lease.query(`SELECT COUNT(*) AS n FROM \`${table}\` WHERE id = ?`,[101])).rows[0].n);
    assert.equal(count,1n,'prior write is durable and must never be described as rolled back');
    assert.ok(pool.stats.created>=2);
    assert.equal(pool.stats.pending,0);
  }finally{
    await pool.close();
    const cleanup=await connectDatabase(target);
    try{
      await cleanup.query(`DROP TABLE IF EXISTS \`${ddl}\``);
      await cleanup.query(`DROP TABLE IF EXISTS \`${table}\``);
    }finally{await cleanup.close();}
  }
});
live('explicit COMMIT inside managed callback is detected instead of claiming a second commit',
  {timeout:15000},async()=>{
  const db=await connectDatabase(target);
  try{
    await assert.rejects(db.transaction(async tx=>{
      await tx.query('SELECT ? AS before_commit',[5]);
      await tx.query('COMMIT');
    }),error=>error.code==='TRANSACTION_OUTCOME_UNKNOWN');
    assert.equal(db.closed,true);
  }finally{await db.close();}
});
