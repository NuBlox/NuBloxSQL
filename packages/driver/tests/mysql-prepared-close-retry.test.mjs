import {test} from 'node:test';
import assert from 'node:assert/strict';
import {MysqlPreparedStatement} from '../dist/vendors/mysql/prepared.js';
import {fail} from '../dist/core/errors.js';

const result={rows:[],columns:[],affectedRows:0,insertId:0};

test('close queue overload preserves prepared handle and permits later cleanup',async()=>{
 let attempts=0,executions=0;
 const statement=new MysqlPreparedStatement(
  0,
  async()=>{executions++;return result;},
  async()=>{if(++attempts===1)throw fail('RESOURCE_LIMIT','Queue capacity reached');},
  ()=>{},
  async()=>[result]
 );
 await assert.rejects(statement.close(),e=>e.code==='RESOURCE_LIMIT');
 assert.equal(statement.closed,false,'a failed enqueue must not irreversibly close the handle');
 assert.deepEqual(await statement.executeResults(),[result]);
 assert.deepEqual(await statement.execute(),result);
 assert.equal(executions,1);
 await statement.close();
 assert.equal(statement.closed,true);
 assert.equal(attempts,2,'later close must retry only the unsent cleanup');
 await statement.close();
 assert.equal(attempts,2,'completed cleanup is idempotent');
 await assert.rejects(statement.execute(),e=>e.code==='CONNECTION_CLOSED');
});

test('concurrent callers share the failed close, then a later caller retries',async()=>{
 let rejectFirst,attempts=0;
 const gate=new Promise((_,reject)=>{rejectFirst=reject;});
 const statement=new MysqlPreparedStatement(
  0,async()=>result,async()=>{
   attempts++;
   if(attempts===1)await gate;
  },()=>{},async()=>[result]
 );
 const first=statement.close();
 const second=statement.close();
 assert.equal(statement.closed,true,'concurrent cleanup prevents new executions');
 rejectFirst(fail('RESOURCE_LIMIT','Queue capacity reached'));
 const outcome=await Promise.allSettled([first,second]);
 assert.ok(outcome.every(o=>o.status==='rejected'&&o.reason.code==='RESOURCE_LIMIT'));
 assert.equal(attempts,1,'no concurrent duplicate COM_STMT_CLOSE');
 assert.equal(statement.closed,false);
 await statement.close();
 assert.equal(attempts,2);
 assert.equal(statement.closed,true);
});

test('a concurrent socket revocation always wins over a failed close enqueue',async()=>{
 let rejectClose;
 const gate=new Promise((_,reject)=>{rejectClose=reject;});
 const statement=new MysqlPreparedStatement(
  0,async()=>result,async()=>gate,()=>{},async()=>[result]
 );
 const pending=statement.close();
 statement.invalidate();
 rejectClose(fail('RESOURCE_LIMIT','Queue capacity reached'));
 await assert.rejects(pending,e=>e.code==='RESOURCE_LIMIT');
 assert.equal(statement.closed,true,'a terminated physical session is never revived');
 await assert.rejects(statement.execute(),e=>e.code==='CONNECTION_CLOSED');
 await statement.close();
});
