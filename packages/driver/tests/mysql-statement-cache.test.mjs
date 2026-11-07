import {test} from 'node:test';
import assert from 'node:assert/strict';
import {MysqlStatementCache} from '../dist/vendors/mysql/statement-cache.js';
import {validate} from '../dist/vendors/mysql/configuration.js';

const prepared=(id)=>({id,parameterCount:id%3});

test('exact SQL cache is disabled unless explicitly configured',()=>{
  const target={
    engine:'mysql',host:'127.0.0.1',port:3306,
    user:'root',password:'test',security:'isolated-local'
  };
  assert.equal(validate(target).statementCacheSize,undefined);
  assert.equal(new MysqlStatementCache(0).capacity,0);
  const off=new MysqlStatementCache(0);
  assert.throws(()=>off.remember('SELECT ?',prepared(1)),
    error=>error.code==='INVALID_INPUT');
  for(const value of [-1,17,NaN,Infinity,1.5,'3',null,undefined]){
    assert.throws(()=>new MysqlStatementCache(value),
      error=>error.code==='INVALID_INPUT');
    assert.throws(()=>validate({...target,statementCacheSize:value}),
      error=>error.code==='INVALID_INPUT');
  }
  for(const value of [0,1,8,16]){
    assert.equal(validate({...target,statementCacheSize:value})
      .statementCacheSize,value);
  }
});

test('bounded LRU retains exact SQL keys and evicts least recently used handle',()=>{
  const cache=new MysqlStatementCache(2);
  assert.equal(cache.remember('SELECT ? AS a',prepared(1)),undefined);
  assert.equal(cache.remember('SELECT ? AS b',prepared(2)),undefined);
  assert.equal(cache.size,2);
  assert.equal(cache.get('SELECT ? AS a')?.id,1);
  assert.equal(cache.remember('SELECT ? AS a',prepared(1)),undefined);
  assert.deepEqual(cache.removeOldest(),prepared(2));
  cache.remember('SELECT ? AS b',prepared(3));
  assert.deepEqual(cache.remember('SELECT ? AS c',prepared(4)),prepared(1));
  assert.equal(cache.size,2);
  assert.equal(cache.get('SELECT ? AS a'),undefined);
  assert.deepEqual(cache.get('SELECT ? AS c'),prepared(4));
  assert.deepEqual(cache.drop('SELECT ? AS b'),prepared(3));
  assert.equal(cache.drop('SELECT ? AS b'),undefined);
  assert.equal(cache.size,1);
  cache.clear();
  assert.equal(cache.size,0);
  assert.equal(cache.removeOldest(),undefined);
});

test('refresh is explicit and permits new handle replacement without leaking LRU order',()=>{
  const cache=new MysqlStatementCache(2);
  cache.remember('SELECT ?',prepared(1));
  cache.remember('SELECT ? ',prepared(2));
  // A mere lookup does not promote a failed or abandoned statement.
  assert.equal(cache.get('SELECT ?')?.id,1);
  assert.deepEqual(cache.remember('SELECT ? /*new*/',prepared(3)),
    prepared(1));
  assert.equal(cache.get('SELECT ?'),undefined);
  const replaced=cache.remember('SELECT ? ',prepared(4));
  assert.equal(replaced,undefined);
  assert.equal(cache.get('SELECT ? ')?.id,4);
  assert.equal(cache.size,2);
});
