import {test} from 'node:test';
import assert from 'node:assert/strict';
import {connectDatabase} from '../dist/index.js';

const live=process.env.NUBLOX_LIVE_MYSQL==='1'?test:test.skip;
const target={
  engine:'mysql',host:'127.0.0.1',port:Number(process.env.MYSQL_PORT??3306),
  user:process.env.MYSQL_USER??'root',
  password:process.env.MYSQL_PASSWORD??'test-password',
  database:process.env.MYSQL_DATABASE??'nublox_test',
  security:'isolated-local',timeoutMs:10000
};

for(const completionType of ['CHAIN','RELEASE']){
  live('native transactions suppress '+completionType+' completion policy on COMMIT and ROLLBACK',
    {timeout:20000},async()=>{
    const db=await connectDatabase(target);
    try{
      await db.query("SET SESSION completion_type = '"+completionType+"'");
      const transactionPolicy=async()=>(
        await db.query('SELECT @@session.completion_type AS completion_policy')
      ).rows[0].completion_policy;
      assert.equal(await transactionPolicy(),completionType);
      const first=await db.transaction(async tx=>{
        assert.equal((await tx.query('SELECT ? AS inside',[37])).rows[0].inside,37n);
        return 'acknowledged';
      });
      assert.equal(first,'acknowledged');
      assert.equal(db.closed,false,'commit must never chain or release the native socket');
      await assert.rejects(db.transaction(async tx=>{
        await tx.query('SELECT ? AS inside',[38]);
        throw Error('application rollback');
      }),/application rollback/);
      assert.equal(db.closed,false,'rollback must never chain or release the socket');
      assert.equal(await transactionPolicy(),completionType,
        'the driver must override completion policy per command, not mutate session settings');
      assert.equal((await db.query('SELECT ? AS healthy',[39])).rows[0].healthy,39n);
    }finally{await db.close();}
  });
}
